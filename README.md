# HealthBot AI

Media skrining awal kondisi kesehatan berdasarkan gejala.
Tim ONIC, SMA Labschool Jakarta. NEST UI 2026, subtema Diagnostic Intelligence.

## Isi folder

```
healthbot/
├── index.html      antarmuka pengguna
├── api/
│   └── chat.js     serverless function (red flag + Gemini)
└── README.md
```

Tidak perlu `package.json` dan tidak perlu install apa pun. Vercel otomatis
mengenali folder `api/` sebagai serverless function.

## Arsitektur

```
input gejala
     |
     v
[LAPIS 1] Detektor red flag, aturan kaku tanpa AI
     |  kena  -> langsung "MERAH / ke IGD", tidak menunggu model
     |  lolos
     v
[LAPIS 2] Gemini 2.5 Flash, system prompt ketat, output JSON terstruktur
     |  gagal -> jawaban cadangan "KUNING", tidak pernah diam
     v
[LAPIS 3] Antarmuka kartu triase + disclaimer permanen
```

Lapis 1 ada karena model AI bisa meremehkan gejala gawat. Aturan kaku tidak
bisa. Ini jawaban untuk pertanyaan juri "bagaimana kalau AI-nya salah".

Prinsip kedua yang dipakai adalah **safe-side bias**: bila ragu antara dua
tingkat urgensi, sistem selalu memilih yang lebih tinggi.

## Cara deploy

### 1. Ambil API key Gemini

Buka https://aistudio.google.com/apikey, login dengan akun Google, klik
"Create API key". Salin dan simpan. Gratis, tanpa kartu kredit.

### 2. Upload ke GitHub

Buat akun di https://github.com, buat repository baru bernama `healthbot`,
lalu unggah tiga file di atas dengan tombol "uploading an existing file".
Pastikan `chat.js` tetap berada di dalam folder `api`.

### 3. Hubungkan ke Vercel

Buka https://vercel.com, klik "Sign up", pilih "Continue with GitHub".
Lalu "Add New" > "Project" > pilih repository `healthbot` > "Import".

### 4. Simpan API key sebagai environment variable

Sebelum menekan Deploy, buka bagian **Environment Variables** dan isi:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | tempel API key dari langkah 1 |

Ini bagian paling penting. Key disimpan di server, tidak pernah dikirim ke
browser, jadi tidak bisa dicuri lewat "view source".

### 5. Deploy

Tekan "Deploy", tunggu sekitar satu menit. Situs akan hidup di alamat
seperti `https://healthbot-xxxx.vercel.app`.

Setiap kali kalian mengubah file di GitHub, Vercel otomatis deploy ulang.

## Kalau muncul error

| Gejala | Penyebab dan solusi |
|---|---|
| Selalu balas "mode aman" | `GEMINI_API_KEY` belum diisi atau salah. Cek di Settings > Environment Variables, lalu Redeploy. |
| Error 404 model | Nama model berubah. Buka `api/chat.js` baris atas, ganti `gemini-2.5-flash` dengan nama model yang tersedia di AI Studio. |
| Error 429 | Kuota harian gratis habis. Tunggu reset atau pakai key lain. |
| Perubahan tidak muncul | Buka tab Deployments di Vercel, pastikan deploy terbaru statusnya Ready. |

Untuk melihat pesan error asli, buka project di Vercel, masuk tab **Logs**,
lalu kirim pesan dari situs. Log dari `console.error` akan muncul di sana.

## Yang perlu dikerjakan untuk naskah lomba

1. **Uji akurasi triase.** Buat 20 sampai 30 kasus skenario (vignette),
   tentukan jawaban benarnya bersama guru biologi atau dokter, lalu hitung
   berapa persen HealthBot menempatkan tingkat urgensi dengan tepat.
   Laporkan juga **undertriage rate**, yaitu berapa kali kasus gawat dinilai
   ringan. Angka ini yang paling penting dan paling jujur.
2. **Uji kebergunaan.** Sebar kuesioner SUS (10 pertanyaan baku) ke 20 sampai
   30 responden, laporkan skornya 0 sampai 100.
3. **Dokumentasikan daftar red flag** di lampiran naskah beserta rujukannya.
   Ini bukti kalian tidak asal menaruh AI di depan orang sakit.

## Menambah aturan red flag

Buka `api/chat.js`, cari array `ATURAN_RED_FLAG`, tambahkan objek baru:

```js
{
  id: "nama_pendek",
  ringkasan: "Kalimat penjelasan untuk pengguna.",
  semua: [
    /pola pertama|sinonimnya/,
    /pola kedua yang juga harus ada/,
  ],
},
```

Semua pola di dalam `semua` harus cocok agar aturan terpicu. Untuk aturan yang
cukup satu kata kunci, isi `semua` dengan satu regex berisi alternatif.

Teks dinormalisasi dulu menjadi huruf kecil tanpa tanda baca, jadi tulis pola
tanpa huruf kapital dan tanpa tanda hubung.
