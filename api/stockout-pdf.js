const FILE_ID = "15dOI-2gYbOLEett8Jfu4OWilAytZdM26";
const DOWNLOAD_URL = `https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download`;

async function fetchWithRedirects(url, limit = 4) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    redirect: "manual",
  });

  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && limit > 0) {
    return fetchWithRedirects(new URL(response.headers.get("location"), url).toString(), limit - 1);
  }

  return response;
}

module.exports = async function handler(req, res) {
  try {
    const response = await fetchWithRedirects(DOWNLOAD_URL);
    if (!response.ok) {
      res.status(response.status).json({ error: `Google Drive download failed: ${response.status}` });
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.slice(0, 4).toString() !== "%PDF") {
      res.status(502).json({ error: "Downloaded file is not a PDF." });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="stockout-list.pdf"');
    res.status(200).send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
