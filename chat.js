/**
 * HealthBot AI - lapis server
 * Berjalan sebagai Vercel Serverless Function di /api/chat
 *
 * Alur:
 *   1. Cek red flag dengan aturan (rule-based). Kalau kena, langsung balas IGD
 *      tanpa menunggu AI. Ini supaya kasus gawat tidak pernah bergantung pada
 *      benar atau salahnya model.
 *   2. Kalau lolos, kirim ke Gemini dengan system prompt ketat + skema JSON.
 *   3. Kalau apa pun gagal, balas aman ke tingkat KLINIK. Tidak pernah diam.
 */

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/* ------------------------------------------------------------------ */
/* LAPIS 1 - DETEKTOR RED FLAG (tanpa AI)                              */
/* ------------------------------------------------------------------ */

function normalisasi(teks) {
  return String(teks || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Setiap aturan: SEMUA pola di dalam "semua" harus cocok agar aturan terpicu.
const ATURAN_RED_FLAG = [
  {
    id: "jantung",
    ringkasan:
      "Gejala yang kamu sebutkan termasuk pola nyeri dada yang perlu dinilai segera di IGD.",
    semua: [
      /nyeri dada|sakit dada|dada sakit|dada nyeri|nyeri di dada|dada terasa berat|dada tertekan|dada seperti ditindih|dada sesak/,
      /menjalar|lengan kiri|tangan kiri|rahang|leher|punggung|keringat dingin|keringat sekujur|mual|muntah|sesak|pucat|lemas berat/,
    ],
  },
  {
    id: "stroke",
    ringkasan:
      "Ada tanda yang mengarah ke gangguan saraf mendadak. Ini kondisi yang penanganannya dihitung per menit.",
    semua: [
      /wajah perot|muka perot|mulut mencong|wajah mencong|bicara pelo|pelo|cadel mendadak|tiba tiba cadel|susah bicara|sulit bicara|lemah sebelah|lemas sebelah|lumpuh sebelah|separuh badan|setengah badan|tidak bisa mengangkat tangan|penglihatan hilang mendadak/,
    ],
  },
  {
    id: "napas",
    ringkasan: "Kesulitan bernapas berat perlu dinilai langsung, bukan ditunggu.",
    semua: [
      /sesak napas|sesak nafas|sulit bernapas|susah bernapas|sulit bernafas|susah bernafas|napas berat|nafas berat|megap/,
      /berat|parah|hebat|sekali|makin|memburuk|tidak bisa bicara|sulit bicara|saat istirahat|tidak kuat jalan|biru/,
    ],
  },
  {
    id: "sianosis",
    ringkasan: "Warna kebiruan pada bibir atau kuku menandakan kekurangan oksigen.",
    semua: [/bibir biru|bibir membiru|kuku biru|ujung jari biru|badan membiru|wajah membiru/],
  },
  {
    id: "kejang",
    ringkasan: "Kejang perlu penilaian medis segera, terutama bila baru pertama kali terjadi.",
    semua: [/kejang|step pada anak|stuip/],
  },
  {
    id: "kesadaran",
    ringkasan: "Perubahan kesadaran adalah salah satu tanda paling serius pada kondisi apa pun.",
    semua: [
      /tidak sadar|hilang kesadaran|tidak sadarkan diri|pingsan|tidak bisa dibangunkan|sulit dibangunkan|tidak merespons|bingung berat|linglung berat|meracau/,
    ],
  },
  {
    id: "perdarahan",
    ringkasan: "Perdarahan seperti ini bisa menandakan sumber perdarahan dalam yang aktif.",
    semua: [
      /muntah darah|batuk darah|bab hitam|berak hitam|buang air besar hitam|tinja hitam|feses hitam|bab berdarah banyak|perdarahan hebat|pendarahan hebat|darah tidak berhenti|perdarahan tidak berhenti|pendarahan tidak berhenti|darah terus keluar/,
    ],
  },
  {
    id: "nyeri_kepala",
    ringkasan: "Nyeri kepala yang muncul mendadak dan sangat hebat perlu disingkirkan penyebab seriusnya.",
    semua: [
      /sakit kepala|nyeri kepala|kepala sakit|pusing/,
      /mendadak|tiba tiba|paling hebat|hebat sekali|sangat hebat|luar biasa|belum pernah sesakit|terparah|seperti meledak/,
    ],
  },
  {
    id: "alergi_berat",
    ringkasan: "Pembengkakan di jalan napas bisa berkembang cepat menjadi sumbatan.",
    semua: [
      /bengkak|membengkak|sembab/,
      /bibir|lidah|tenggorokan|leher|wajah|kelopak mata|seluruh badan/,
    ],
  },
  {
    id: "anafilaksis",
    ringkasan: "Reaksi alergi yang disertai gangguan napas termasuk kegawatan.",
    semua: [/alergi|anafilaksis|habis disengat|digigit serangga|habis makan obat/, /sesak|bengkak|gatal seluruh|pingsan|lemas berat/],
  },
  {
    id: "bayi_demam",
    ringkasan: "Demam pada bayi sangat muda selalu diperlakukan sebagai kegawatan sampai terbukti sebaliknya.",
    semua: [/bayi|neonatus|baru lahir|usia 1 bulan|usia 2 bulan|umur 1 bulan|umur 2 bulan/, /demam|panas|suhu tinggi/],
  },
  {
    id: "anak_tidak_minum",
    ringkasan: "Anak yang tidak mau minum sama sekali berisiko cepat mengalami dehidrasi berat.",
    semua: [/anak|bayi|balita/, /tidak mau minum|tidak bisa minum|menolak minum|muntah terus|muntah setiap/],
  },
  {
    id: "kehamilan",
    ringkasan: "Keluhan ini pada kehamilan perlu dinilai langsung di fasilitas yang punya layanan kebidanan.",
    semua: [/hamil|kehamilan|mengandung/, /perdarahan|pendarahan|keluar darah|flek banyak|nyeri perut hebat|kejang|air ketuban|tidak terasa gerakan/],
  },
  {
    id: "trauma",
    ringkasan: "Cedera dengan mekanisme seperti ini perlu pemeriksaan untuk menyingkirkan cedera dalam.",
    semua: [
      /kecelakaan|tertabrak|jatuh dari|terjatuh dari ketinggian|terbentur kepala|benturan kepala|kepala terbentur|patah tulang|tulang menonjol|luka bakar luas|tersiram air panas seluruh/,
    ],
  },
  {
    id: "keracunan",
    ringkasan: "Paparan zat berbahaya perlu penanganan segera meskipun keluhan masih ringan.",
    semua: [/keracunan|overdosis|menelan racun|minum racun|menelan baterai|gigitan ular|digigit ular|kena bahan kimia/],
  },
  {
    id: "perut_akut",
    ringkasan: "Nyeri perut dengan ciri seperti ini bisa menandakan kegawatan di rongga perut.",
    semua: [/nyeri perut|sakit perut|perut sakit/, /hebat|sangat|tidak tertahankan|tidak tahan|perut keras|perut kaku|tidak bisa berdiri|makin parah/],
  },
];

// Aturan khusus krisis psikologis, responsnya berbeda.
const POLA_KRISIS_MENTAL =
  /bunuh diri|mengakhiri hidup|ingin mati|pengen mati|tidak ingin hidup|ga mau hidup|gak mau hidup|menyakiti diri|melukai diri|nyakitin diri|self harm/;

function balasanKrisisMental() {
  return {
    tingkat_urgensi: "IGD",
    ringkasan:
      "Terima kasih sudah menuliskan ini. Kamu tidak perlu menghadapinya sendirian, dan ada orang yang siap mendengarkan sekarang juga.",
    kemungkinan_kondisi: [],
    yang_harus_dilakukan: [
      "Hubungi 119 lalu tekan ekstensi 8 untuk layanan dukungan psikologis Kementerian Kesehatan.",
      "Ceritakan pada satu orang yang kamu percaya hari ini juga, boleh keluarga, guru, atau teman dekat.",
      "Kalau kamu merasa tidak aman sendirian, minta seseorang menemanimu atau pergi ke IGD terdekat.",
    ],
    tanda_bahaya: [],
    pertanyaan_lanjutan: [],
    sumber: "aturan",
    aturan_terpicu: "krisis_mental",
    catatan_khusus: true,
  };
}

function cekRedFlag(pesan) {
  const teks = normalisasi(pesan);
  if (!teks) return null;

  if (POLA_KRISIS_MENTAL.test(teks)) return balasanKrisisMental();

  for (const aturan of ATURAN_RED_FLAG) {
    const cocok = aturan.semua.every((pola) => pola.test(teks));
    if (!cocok) continue;

    return {
      tingkat_urgensi: "IGD",
      ringkasan: aturan.ringkasan,
      kemungkinan_kondisi: [],
      yang_harus_dilakukan: [
        "Pergi ke IGD rumah sakit terdekat sekarang, jangan menunggu sampai besok.",
        "Hubungi 119 bila butuh ambulans atau kondisi memburuk di perjalanan.",
        "Jangan menyetir sendiri. Minta orang lain mengantar atau panggil bantuan.",
        "Bawa daftar obat yang sedang diminum bila ada.",
      ],
      tanda_bahaya: [],
      pertanyaan_lanjutan: [],
      sumber: "aturan",
      aturan_terpicu: aturan.id,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* LAPIS 2 - MODEL AI                                                  */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `Kamu adalah HealthBot, asisten skrining awal kesehatan berbahasa Indonesia. Kamu BUKAN dokter dan tidak menegakkan diagnosis.

Tugasmu adalah membantu pengguna memahami seberapa mendesak gejala yang mereka alami dan ke mana sebaiknya mereka pergi.

ATURAN WAJIB:
1. Jangan pernah menyebut suatu penyakit sebagai kepastian. Selalu gunakan bahasa kemungkinan, misalnya "gejala ini bisa berkaitan dengan".
2. Bila ragu antara dua tingkat urgensi, selalu pilih yang LEBIH TINGGI. Lebih baik pengguna memeriksakan diri tanpa perlu daripada terlambat.
3. Jangan menyebut nama obat resep, dosis obat apa pun, atau menyarankan menghentikan obat yang sedang diminum.
4. Jangan meminta data pribadi seperti nama lengkap, NIK, atau alamat.
5. Bila informasi masih kurang, tetap berikan penilaian sementara yang aman, lalu ajukan maksimal 3 pertanyaan lanjutan yang spesifik (durasi, intensitas, gejala penyerta, riwayat penyakit, usia).
6. Gunakan bahasa Indonesia sehari-hari yang mudah dipahami orang awam. Bila terpaksa memakai istilah medis, jelaskan singkat dalam tanda kurung.
7. Untuk kemungkinan_kondisi, sebutkan maksimal 3 dan urutkan dari yang paling mungkin.
8. tanda_bahaya harus berisi hal konkret yang bila muncul membuat pengguna harus langsung ke IGD.
9. Jangan pernah menyuruh pengguna hanya menunggu tanpa batas waktu. Selalu beri batas waktu pemantauan yang jelas.

TINGKAT URGENSI:
- MANDIRI: gejala ringan, wajar dirawat di rumah, pantau selama 2 sampai 3 hari.
- KLINIK: sebaiknya diperiksa tenaga medis dalam 1 sampai 2 hari di puskesmas, klinik, atau dokter umum.
- IGD: perlu penanganan segera hari ini juga.

Jawab hanya dalam format JSON sesuai skema yang diberikan. Jangan menambahkan teks di luar JSON.`;

const SKEMA_JAWABAN = {
  type: "OBJECT",
  properties: {
    tingkat_urgensi: { type: "STRING", enum: ["MANDIRI", "KLINIK", "IGD"] },
    ringkasan: { type: "STRING" },
    kemungkinan_kondisi: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nama: { type: "STRING" },
          catatan: { type: "STRING" },
        },
        required: ["nama", "catatan"],
      },
    },
    yang_harus_dilakukan: { type: "ARRAY", items: { type: "STRING" } },
    tanda_bahaya: { type: "ARRAY", items: { type: "STRING" } },
    pertanyaan_lanjutan: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: [
    "tingkat_urgensi",
    "ringkasan",
    "kemungkinan_kondisi",
    "yang_harus_dilakukan",
    "tanda_bahaya",
    "pertanyaan_lanjutan",
  ],
};

const PENGATURAN_KEAMANAN = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }));

function jawabanCadangan(alasan) {
  return {
    tingkat_urgensi: "KLINIK",
    ringkasan:
      "Sistem sedang tidak bisa menilai gejalamu dengan baik saat ini. Supaya aman, anggap keluhan ini perlu diperiksa tenaga medis.",
    kemungkinan_kondisi: [],
    yang_harus_dilakukan: [
      "Periksakan diri ke puskesmas atau klinik terdekat dalam 1 sampai 2 hari.",
      "Segera ke IGD bila keluhan memburuk sebelum sempat diperiksa.",
    ],
    tanda_bahaya: [
      "Sesak napas",
      "Nyeri dada",
      "Penurunan kesadaran",
      "Kejang",
      "Perdarahan yang tidak berhenti",
    ],
    pertanyaan_lanjutan: [],
    sumber: "cadangan",
    alasan_cadangan: alasan,
  };
}

async function tanyaGemini(pesan, riwayat, apiKey) {
  const contents = [];

  for (const item of Array.isArray(riwayat) ? riwayat.slice(-8) : []) {
    if (!item || !item.teks) continue;
    contents.push({
      role: item.peran === "bot" ? "model" : "user",
      parts: [{ text: String(item.teks).slice(0, 2000) }],
    });
  }
  contents.push({ role: "user", parts: [{ text: String(pesan).slice(0, 2000) }] });

  const respons = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      safetySettings: PENGATURAN_KEAMANAN,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
        responseSchema: SKEMA_JAWABAN,
      },
    }),
  });

  if (!respons.ok) {
    const detail = await respons.text();
    throw new Error(`Gemini ${respons.status}: ${detail.slice(0, 300)}`);
  }

  const data = await respons.json();
  const teks = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!teks) throw new Error("Jawaban model kosong atau diblokir filter keamanan.");

  const hasil = JSON.parse(teks);
  hasil.sumber = "model";
  return hasil;
}

/* ------------------------------------------------------------------ */
/* HANDLER                                                             */
/* ------------------------------------------------------------------ */

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Gunakan metode POST." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(200).json(jawabanCadangan("GEMINI_API_KEY belum diatur di Vercel."));
    return;
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const pesan = (body.pesan || "").trim();
  const riwayat = body.riwayat || [];

  if (!pesan) {
    res.status(400).json({ error: "Pesan kosong." });
    return;
  }
  if (pesan.length > 2000) {
    res.status(400).json({ error: "Pesan terlalu panjang. Maksimal 2000 karakter." });
    return;
  }

  // Lapis 1 selalu jalan lebih dulu.
  const redFlag = cekRedFlag(pesan);
  if (redFlag) {
    res.status(200).json(redFlag);
    return;
  }

  // Lapis 2.
  try {
    const hasil = await tanyaGemini(pesan, riwayat, apiKey);
    res.status(200).json(hasil);
  } catch (err) {
    console.error("[healthbot]", err.message);
    res.status(200).json(jawabanCadangan(err.message));
  }
};

function safeParse(teks) {
  try {
    return JSON.parse(teks);
  } catch {
    return {};
  }
}
