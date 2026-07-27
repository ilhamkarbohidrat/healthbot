export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { keluhan } = req.body;

  if (!keluhan) {
    return res.status(400).json({ error: "Keluhan kosong" });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "Kamu adalah asisten skrining kesehatan awal (triase), BUKAN dokter dan BUKAN alat diagnosis. Berdasarkan keluhan pasien, klasifikasikan tingkat urgensi jadi HIJAU (ringan, bisa self-care), KUNING (perlu periksa ke puskesmas/klinik), atau MERAH (darurat, harus segera ke IGD/hubungi 119). Jawab singkat dan jelas, selalu ingatkan bahwa ini bukan diagnosis medis.",
          },
          { role: "user", content: keluhan },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", errText);
      return res.status(502).json({ error: "Gagal mendapat respons dari model" });
    }

    const data = await response.json();
    const hasil = data.choices?.[0]?.message?.content ?? "Tidak ada respons";

    res.status(200).json({ hasil });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Koneksi ke server gagal" });
  }
}
