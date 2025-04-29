import express from "express";
import fs from "fs/promises";
import moment from "moment-timezone";
import axios from "axios";
import { escapeMarkdown } from "../lib/function.js";

const router = express.Router();

router.post("/orderkuota-webhook", async (req, res) => {
  const { reference_id, status } = req.body;
  if (status !== "PAID") return res.sendStatus(200);

  const saldoPath = "./database/saldo_user.json";
  const produkPath = "./database/products.json";

  const saldoData = JSON.parse(await fs.readFile(saldoPath).catch(() => "{}"));
  const produkData = JSON.parse(await fs.readFile(produkPath).catch(() => "{}"));

  // Temukan user yang memiliki transaksi dengan reference_id ini
  const chatId = Object.keys(saldoData).find(id =>
    saldoData[id].transaction?.some(t => t.reffid === reference_id)
  );

  if (!chatId) return res.sendStatus(200);

  const user = saldoData[chatId];
  const trx = user.transaction.find(t => t.reffid === reference_id);
  if (!trx || trx.status === "success") return res.sendStatus(200);

  const produk = produkData[trx.produk];
  if (!produk || produk.stok.length < trx.jumlah) {
    trx.status = "gagal";
    await fs.writeFile(saldoPath, JSON.stringify(saldoData, null, 2));
    return res.sendStatus(200);
  }

  const stokDikirim = produk.stok.splice(0, trx.jumlah);
  produk.sold = (produk.sold || 0) + trx.jumlah;

  const totalBayar = trx.harga + (trx.fee || 0);
  const tanggal = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");

  const struk = buatStruk(produk, trx.jumlah, totalBayar, trx.reffid, stokDikirim, "QRIS");

  trx.status = "success";
  trx.info = struk;
  trx.stok = stokDikirim;
  trx.type = `${produk.category} | ${produk.name}`;

  user.harian.push({
    ...trx
  });

  await fs.writeFile(saldoPath, JSON.stringify(saldoData, null, 2));
  await fs.writeFile(produkPath, JSON.stringify(produkData, null, 2));

  await axios.post(`https://api.telegram.org/bot${global.telegramToken}/sendMessage`, {
    chat_id: chatId,
    text: struk,
    parse_mode: "Markdown"
  });

  res.sendStatus(200);
});

function buatStruk(produk, jumlah, harga, refid, stokList, metode) {
  const tanggal = moment().tz("Asia/Jakarta").format("DD MMMM YYYY");
  const jam = moment().tz("Asia/Jakarta").format("HH:mm:ss");

  const akun = stokList.map((d, i) => `*✦ ⋞ ACCOUNT ${i + 1} ⋟ ✦*\n  Email : ${d.email}\n  Password : ${d.password}\n  Profile : ${d.profile || "~"}\n  PIN : ${d.pin || "~"}\n  2FA : ${d.fa || "~"}`).join("\n\n");

  return `*─֍「 STRUK PEMBELIAN 」֍─*
*┊・ 🍿| ${jumlah}× ${produk.name}*
*┊・ 📱| ID: ${refid}*
*┊・ 🛍️| Metode: ${metode}*
*┊・ 💰| Nominal: Rp ${harga.toLocaleString("id-ID")}*
*┊・ 📅| ${tanggal} ${jam} WIB*
*╰━━━━━━━━━━ᯓ ✈︎*

${akun}

Cek stok lainnya dengan ketik *.stok*
® Cystore apk premium & topup 24jam`;
}

export default router;

