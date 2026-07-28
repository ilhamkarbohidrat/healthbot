/**
 * HealthBot - lapis frontend (jalan di browser)
 * Tugasnya: ambil input pengguna, kirim ke /api/chat, tampilkan hasil triase.
 */

const elChat = document.getElementById("chat");
const elEmptyState = document.getElementById("empty-state");
const elInput = document.getElementById("input-keluhan");
const elTombolPeriksa = document.getElementById("btn-periksa");
const elChip = document.querySelectorAll(".chip");

// Riwayat percakapan, dikirim ke backend supaya AI punya konteks.
let riwayat = [];

function waktuSekarang() {
  const now = new Date();
  return now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function tambahBubbleUser(teks) {
  if (elEmptyState) elEmptyState.style.display = "none";
  const baris = document.createElement("div");
  baris.className = "baris-user";
  const bubble = document.createElement("div");
  bubble.className = "bubble-user";
  bubble.textContent = teks;
  baris.appendChild(bubble);
  elChat.appendChild(baris);
  elChat.scrollTop = elChat.scrollHeight;
}

function bungkusBalasanBot(elIsi) {
  const baris = document.createElement("div");
  baris.className = "baris-bot";
  const avatar = document.createElement("div");
  avatar.className = "avatar-bot";
  avatar.textContent = "🤖";
  baris.appendChild(avatar);
  baris.appendChild(elIsi);
  return baris;
}

// Mapping tingkat urgensi dari backend ke tampilan pill + posisi slider.
const PETA_URGENSI = {
  MANDIRI: { teks: "Bisa dirawat mandiri", kelas: "hijau", posisi: 12, emoji: "🌿" },
  KLINIK: { teks: "Sebaiknya ke klinik", kelas: "kuning", posisi: 50, emoji: "🩹" },
  IGD: { teks: "Segera ke IGD", kelas: "merah", posisi: 88, emoji: "🚨" },
};

function buatKartuTriase(hasil, modeAman) {
  const info = PETA_URGENSI[hasil.tingkat_urgensi] || PETA_URGENSI.KLINIK;

  const kartu = document.createElement("div");
  kartu.className = "kartu-triase";

  kartu.innerHTML = `
    <div class="header-kartu">
      <span>TRIASE · ${waktuSekarang()}</span>
      <span>${modeAman ? "MODE AMAN" : "PENILAIAN MODEL"}</span>
    </div>

    <div class="pill-urgensi pill-${info.kelas}">
      <span>${info.emoji}</span> ${info.teks}
    </div>

    <div class="slider-triase">
      <div class="slider-thumb thumb-${info.kelas}" style="left:${info.posisi}%"></div>
    </div>
    <div class="label-slider">
      <span class="${hasil.tingkat_urgensi === "MANDIRI" ? "aktif" : ""}">Rawat mandiri</span>
      <span class="${hasil.tingkat_urgensi === "KLINIK" ? "aktif" : ""}">Klinik</span>
      <span class="${hasil.tingkat_urgensi === "IGD" ? "aktif" : ""}">IGD</span>
    </div>

    <p class="ringkasan" style="font-size:15px; margin:16px 0 0; line-height:1.55;">${escapeHTML(hasil.ringkasan || "")}</p>

    ${
      hasil.kemungkinan_kondisi && hasil.kemungkinan_kondisi.length
        ? `<div class="blok-detail">
            <h4>Kemungkinan kaitan</h4>
            <ul>${hasil.kemungkinan_kondisi
              .map((k) => `<li><strong>${escapeHTML(k.nama)}</strong> — ${escapeHTML(k.catatan)}</li>`)
              .join("")}</ul>
          </div>`
        : ""
    }

    ${
      hasil.yang_harus_dilakukan && hasil.yang_harus_dilakukan.length
        ? `<div class="blok-detail">
            <h4>Yang sebaiknya dilakukan</h4>
            <ul>${hasil.yang_harus_dilakukan.map((s) => `<li>${escapeHTML(s)}</li>`).join("")}</ul>
          </div>`
        : ""
    }

    ${
      hasil.tanda_bahaya && hasil.tanda_bahaya.length
        ? `<div class="blok-detail">
            <h4>Segera ke IGD bila muncul</h4>
            <ul>${hasil.tanda_bahaya.map((s) => `<li>${escapeHTML(s)}</li>`).join("")}</ul>
          </div>`
        : ""
    }

    <p class="disclaimer">Penilaian ini baru gambaran awal. Untuk memastikan kondisimu, pemeriksaan langsung oleh dokter tetap yang paling bisa diandalkan.</p>
  `;

  return bungkusBalasanBot(kartu);
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// Untuk mode "curhat" dan "umum" — jawaban ditampilkan sebagai bubble teks biasa,
// bukan kartu triase.
function buatBubbleBot(teks, mode) {
  const bubble = document.createElement("div");
  bubble.className = `bubble-bot bubble-${mode === "curhat" ? "curhat" : "umum"}`;
  bubble.textContent = teks;
  return bungkusBalasanBot(bubble);
}

function renderHasil(data) {
  if (data.mode === "curhat" || data.mode === "umum") {
    elChat.appendChild(buatBubbleBot(data.jawaban || "", data.mode));
  } else {
    const modeAman = data.sumber === "cadangan";
    elChat.appendChild(buatKartuTriase(data, modeAman));
  }
}

async function periksaKeluhan(teksKeluhan) {
  const keluhan = (teksKeluhan ?? "").trim();

  if (!keluhan) {
    if (elEmptyState) elEmptyState.style.display = "none";
    elChat.appendChild(buatKartuTriase({ tingkat_urgensi: "KLINIK", ringkasan: "Permintaan tidak bisa diproses: Keluhan kosong", yang_harus_dilakukan: ["Tulis keluhanmu di kolom teks terlebih dahulu."] }, true));
    return;
  }

  tambahBubbleUser(keluhan);
  elInput.value = "";
  elTombolPeriksa.disabled = true;
  elTombolPeriksa.textContent = "Memproses...";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pesan: keluhan, riwayat }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Gagal memproses permintaan");
    }

    renderHasil(data);

    // Simpan ke riwayat supaya AI punya konteks percakapan berikutnya.
    const teksBalasan = data.mode === "curhat" || data.mode === "umum" ? data.jawaban : data.ringkasan;
    riwayat.push({ peran: "user", teks: keluhan });
    riwayat.push({ peran: "bot", teks: teksBalasan || "" });
  } catch (err) {
    console.error("Gagal fetch:", err);
    elChat.appendChild(
      buatKartuTriase(
        {
          mode: "triase",
          tingkat_urgensi: "KLINIK",
          ringkasan: "Koneksi ke server gagal. Supaya aman, anggap keluhan ini perlu diperiksa tenaga medis.",
          yang_harus_dilakukan: [
            "Coba lagi setelah koneksi stabil.",
            "Periksakan diri ke puskesmas atau klinik bila keluhan berlanjut.",
          ],
        },
        true
      )
    );
  } finally {
    elTombolPeriksa.disabled = false;
    elTombolPeriksa.textContent = "Periksa";
    elChat.scrollTop = elChat.scrollHeight;
  }
}

elTombolPeriksa.addEventListener("click", () => periksaKeluhan(elInput.value));

elInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    periksaKeluhan(elInput.value);
  }
});

elChip.forEach((chip) => {
  chip.addEventListener("click", () => periksaKeluhan(chip.textContent));
});
