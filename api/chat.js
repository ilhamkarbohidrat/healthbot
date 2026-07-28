/**
 * HealthBot AI - lapis server
 * Berjalan sebagai Vercel Serverless Function di /api/chat
 *
 * Alur:
 *   1. Cek red flag dengan aturan (rule-based). Kalau kena, langsung balas IGD
 *      tanpa menunggu AI. Ini supaya kasus gawat tidak pernah bergantung pada
 *      benar atau salahnya model. Ini SELALU jalan duluan, terlepas dari mode.
 *   2. Kalau lolos, kirim ke Groq dengan system prompt yang punya 3 mode:
 *        - triase: skrining urgensi keluhan fisik (bukan diagnosis pasti)
 *        - curhat: teman ngobrol untuk keluh kesah/perasaan
 *        - umum:   asisten serba bisa (pengetahuan umum, matematika, dll)
 *   3. Kalau apa pun gagal, balas aman ke tingkat KLINIK. Tidak pernah diam.
 */

const MODEL = "llama-3.3-70b-versatile";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

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
    mode: "triase",
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
      mode: "triase",
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
/* LAPIS 2 - MODEL AI (Groq)                                           */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `Kamu adalah HealthBot, asisten AI berbahasa Indonesia yang ramah dan hangat. Kamu punya TIGA mode. Untuk setiap pesan pengguna, tentukan mode yang paling cocok, lalu balas HANYA dalam format JSON sesuai mode itu (tanpa teks apa pun di luar JSON).

=== MODE 1: TRIASE (keluhan fisik) ===
Dipakai kalau pengguna menceritakan gejala atau keluhan fisik (demam, batuk, nyeri, dsb).
Kamu BUKAN dokter dan TIDAK menegakkan diagnosis pasti. Tugasmu hanya menilai seberapa mendesak gejala itu dan ke mana sebaiknya pengguna pergi.

Aturan wajib mode ini:
1. Jangan pernah menyebut suatu penyakit sebagai kepastian. Selalu gunakan bahasa kemungkinan, misalnya "gejala ini bisa berkaitan dengan".
2. Bila ragu antara dua tingkat urgensi, selalu pilih yang LEBIH TINGGI.
3. Jangan menyebut nama obat resep, dosis obat apa pun, atau menyarankan menghentikan obat yang sedang diminum.
4. Jangan meminta data pribadi seperti nama lengkap, NIK, atau alamat.
5. Bila informasi masih kurang, tetap berikan penilaian sementara yang aman, lalu ajukan maksimal 3 pertanyaan lanjutan yang spesifik.
6. Gunakan bahasa Indonesia sehari-hari. Bila terpaksa memakai istilah medis, jelaskan singkat dalam tanda kurung.
7. kemungkinan_kondisi maksimal 3, urutkan dari yang paling mungkin.
8. tanda_bahaya harus berisi hal konkret yang bila muncul membuat pengguna harus langsung ke IGD.
9. Jangan pernah menyuruh pengguna hanya menunggu tanpa batas waktu. Beri batas waktu pemantauan yang jelas.

Tingkat urgensi: MANDIRI (ringan, rawat sendiri 2-3 hari), KLINIK (periksa ke puskesmas/klinik dalam 1-2 hari), IGD (segera hari ini juga).

Format JSON mode ini:
{
  "mode": "triase",
  "tingkat_urgensi": "MANDIRI" | "KLINIK" | "IGD",
  "ringkasan": string,
  "kemungkinan_kondisi": [ { "nama": string, "catatan": string }, ... maksimal 3 ],
  "yang_harus_dilakukan": [ string, ... ],
  "tanda_bahaya": [ string, ... ],
  "pertanyaan_lanjutan": [ string, ... maksimal 3 ]
}

=== MODE 2: TEMAN CURHAT ===
Dipakai kalau pengguna cerita perasaan, keluh kesah, masalah sehari-hari, atau butuh didengarkan (bukan gejala fisik, bukan pertanyaan pengetahuan).

Aturan wajib mode ini:
1. Dengarkan dan validasi perasaan pengguna dengan tulus, jangan menggurui atau buru-buru kasih solusi kalau mereka cuma butuh didengar.
2. JANGAN PERNAH mendiagnosis atau melabeli kondisi mental apa pun (jangan bilang "kamu depresi", "kamu kena anxiety disorder", dsb).
3. Ajukan pertanyaan terbuka yang menunjukkan kamu benar-benar peduli, bukan interogasi.
4. Kalau ceritanya menunjukkan tekanan yang berat atau berkepanjangan, secara halus dan tidak memaksa, ajak mereka pertimbangkan cerita ke orang dewasa terpercaya, guru BK, atau psikolog. Tidak perlu setiap balasan menyarankan ini, hanya kalau memang relevan.
5. Nada bicara hangat, singkat, natural, seperti teman ngobrol, bukan seperti robot atau tenaga medis.
6. Jangan pernah mendorong perilaku yang merugikan diri sendiri, dan jangan menyepelekan perasaan mereka.

Format JSON mode ini:
{
  "mode": "curhat",
  "jawaban": string
}

=== MODE 3: ASISTEN UMUM ===
Dipakai untuk semua hal lain: sapaan, pertanyaan pengetahuan umum, matematika, prediksi, obrolan santai, dll.
Jawab natural, jelas, dan membantu seperti asisten AI pada umumnya.

Format JSON mode ini:
{
  "mode": "umum",
  "jawaban": string
}

PENTING: pilih mode berdasarkan isi pesan terakhir pengguna. Selalu keluarkan JSON valid sesuai salah satu dari ketiga struktur di atas, tidak ada field tambahan, tidak ada teks di luar JSON.

CONTOH PEMILIHAN MODE (ikuti pola ini, jangan selalu anggap semua pesan berkaitan dengan kesehatan):
- "5 x 6 berapa?" -> mode umum
- "siapa presiden pertama Indonesia?" -> mode umum
- "eh nama kamu siapa?" -> mode umum
- "menurut kamu besok bakal hujan gak?" -> mode umum
- "aku capek banget sama tugas sekolah hari ini" -> mode curhat
- "aku ngerasa sendirian belakangan ini" -> mode curhat
- "demam 2 hari, batuk kering, badan pegal" -> mode triase
- "perut sakit banget dari tadi pagi" -> mode triase

Jangan pernah menganggap pertanyaan pengetahuan umum atau matematika sebagai keluhan kesehatan hanya karena kamu bernama HealthBot.`;

// Heuristik ringan: dipakai HANYA untuk menentukan jenis fallback yang tepat
// saat AI gagal merespons, bukan untuk menggantikan penilaian AI.
const KATA_TERKAIT_KESEHATAN =
  /demam|panas badan|sakit|nyeri|pusing|mual|muntah|batuk|pilek|diare|mencret|gatal|bengkak|luka|lemas|sesak|kejang|pingsan|cedera|memar|alergi/;

function pesanMiripKeluhanKesehatan(pesan) {
  return KATA_TERKAIT_KESEHATAN.test(normalisasi(pesan));
}

function jawabanCadanganUmum() {
  return {
    mode: "umum",
    jawaban:
      "Maaf, sistem sedang mengalami gangguan sesaat. Coba tanya ulang beberapa saat lagi ya.",
    sumber: "cadangan",
  };
}

function jawabanCadangan(alasan) {
  return {
    mode: "triase",
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

async function tanyaGroq(pesan, riwayat, apiKey) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  for (const item of Array.isArray(riwayat) ? riwayat.slice(-8) : []) {
    if (!item || !item.teks) continue;
    messages.push({
      role: item.peran === "bot" ? "assistant" : "user",
      content: String(item.teks).slice(0, 2000),
    });
  }
  messages.push({ role: "user", content: String(pesan).slice(0, 2000) });

  const respons = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    }),
  });

  if (!respons.ok) {
    const detail = await respons.text();
    throw new Error(`Groq ${respons.status}: ${detail.slice(0, 300)}`);
  }

  const data = await respons.json();
  const teks = data?.choices?.[0]?.message?.content;
  if (!teks) throw new Error("Jawaban model kosong.");

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

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const pesan = (body.pesan || "").trim();
  const riwayat = body.riwayat || [];

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const fallback = pesanMiripKeluhanKesehatan(pesan)
      ? jawabanCadangan("GROQ_API_KEY belum diatur di Vercel.")
      : jawabanCadanganUmum();
    res.status(200).json(fallback);
    return;
  }

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
    const hasil = await tanyaGroq(pesan, riwayat, apiKey);
    res.status(200).json(hasil);
  } catch (err) {
    console.error("[healthbot]", err.message);
    const fallback = pesanMiripKeluhanKesehatan(pesan)
      ? jawabanCadangan(err.message)
      : jawabanCadanganUmum();
    res.status(200).json(fallback);
  }
};

function safeParse(teks) {
  try {
    return JSON.parse(teks);
  } catch {
    return {};
  }
}
