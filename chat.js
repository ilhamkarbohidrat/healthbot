/**
 * HealthBot - lapis frontend (jalan di browser)
 * Tugasnya: ambil input pengguna, kirim ke /api/chat, tampilkan hasil triase.
 */

const elChat = document.getElementById("chat");
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
  const bubble = document.createElement("div");
  bubble.className = "bubble bubble-user";
  bubble.textContent = teks;
  elChat.appendChild(bubble);
  elChat.scrollTop = elChat.scrollHeight;
}

// Mapping tingkat urgensi dari backend ke label warna di UI.
const PETA_URGENSI = {
  MANDIRI: { label: "HIJAU", kelas: "hijau" },
  KLINIK: { label: "KUNING", kelas: "kuning" },
  IGD: { label: "MERAH", kelas: "merah" },
};

function buatKartuTriase(hasil, modeAman) {
  const info = PETA_URGENSI[hasil.tingkat_urgensi] || PETA_URGENSI.KLINIK;

  const kartu = document.createElement("div");
  kartu.className = `kartu-triase kartu-${info.kelas}`;

  const tindakanTeks =
    hasil.tingkat_urgensi === "IGD"
      ? "Segera ke IGD"
      : hasil.tingkat_urgensi === "MANDIRI"
      ? "Rawat di rumah, pantau kondisi"
      : "Periksa ke puskesmas atau klinik";

  kartu.innerHTML = `
    <div class="strip"><span>${info.label}</span></div>
    <div class="isi">
      <div class="header-kartu">
        <span class="waktu">TRIASE / ${waktuSekarang()}</span>
        ${modeAman ? '<span class="badge-aman">MODE AMAN</span>' : ""}
      </div>

      <div class="tab-urgensi">
        <div class="tab ${info.label === "HIJAU" ? "aktif hijau" : "nonaktif"}">HIJAU</div>
        <div class="tab ${info.label === "KUNING" ? "aktif kuning" : "nonaktif"}">KUNING</div>
        <div class="tab ${info.label === "MERAH" ? "aktif merah" : "nonaktif"}">MERAH</div>
      </div>

      <p class="ringkasan">${escapeHTML(hasil.ringkasan || "")}</p>
      <p class="tindakan"><strong>Tindakan:</strong> ${tindakanTeks}</p>

      ${
        hasil.kemungkinan_kondisi && hasil.kemungkinan_kondisi.length
          ? `<div class="blok">
              <h4>KEMUNGKINAN KAITAN</h4>
              <ul>${hasil.kemungkinan_kondisi
                .map((k) => `<li><strong>${escapeHTML(k.nama)}</strong> — ${escapeHTML(k.catatan)}</li>`)
                .join("")}</ul>
            </div>`
          : ""
      }

      <div class="blok">
        <h4>YANG SEBAIKNYA DILAKUKAN</h4>
        <ul>${(hasil.yang_harus_dilakukan || []).map((s) => `<li>${escapeHTML(s)}</li>`).join("")}</ul>
      </div>

      ${
        hasil.tanda_bahaya && hasil.tanda_bahaya.length
          ? `<div class="blok">
              <h4>SEGERA KE IGD BILA MUNCUL</h4>
              <ul>${hasil.tanda_bahaya.map((s) => `<li>${escapeHTML(s)}</li>`).join("")}</ul>
            </div>`
          : ""
      }

      ${
        hasil.pertanyaan_lanjutan && hasil.pertanyaan_lanjutan.length
          ? `<div class="blok">
              <h4>BOLEH DIJAWAB SUPAYA LEBIH AKURAT</h4>
              <ul>${hasil.pertanyaan_lanjutan.map((s) => `<li>${escapeHTML(s)}</li>`).join("")}</ul>
            </div>`
          : ""
      }

      <p class="disclaimer">Ini bukan diagnosis. Hanya dokter yang berwenang menegakkan diagnosis dan menentukan penanganan.</p>
    </div>
  `;

  return kartu;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

async function periksaKeluhan(teksKeluhan) {
  const keluhan = (teksKeluhan ?? "").trim();

  if (!keluhan) {
    elChat.appendChild(buatKartuTriase({ tingkat_urgensi: "KLINIK", ringkasan: "Permintaan tidak bisa diproses: Keluhan kosong", yang_harus_dilakukan: ["Tulis keluhanmu di kolom teks terlebih dahulu."] }, true));
    return;
  }

  tambahBubbleUser(keluhan);
  elInput.value = "";
  elTombolPeriksa.disabled = true;
  elTombolPeriksa.textContent = "Memeriksa...";

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

    const modeAman = data.sumber === "cadangan";
    elChat.appendChild(buatKartuTriase(data, modeAman));

    // Simpan ke riwayat supaya AI punya konteks percakapan berikutnya.
    riwayat.push({ peran: "user", teks: keluhan });
    riwayat.push({ peran: "bot", teks: data.ringkasan || "" });
  } catch (err) {
    console.error("Gagal fetch:", err);
    elChat.appendChild(
      buatKartuTriase(
        {
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
