const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

/* ========================= */
let cacheTX = null;
let cacheMD5 = null;
let history = [];
let countdown = 30;

let stats = { win: 0, lose: 0, total: 0 };
let lastPhien = null;

/* ========================= UTILS ========================= */
function entropyHex(h) {
  const freq = {};
  for (let c of h) freq[c] = (freq[c] || 0) + 1;
  const n = h.length;
  let e = 0;
  for (let k in freq) {
    let p = freq[k] / n;
    e -= p * Math.log2(p);
  }
  return e;
}

function bitDensity(md5) {
  const bits = BigInt("0x" + md5).toString(2).padStart(128, "0");
  return bits.split("1").length - 1;
}

function hexEnergy(md5) {
  return md5.split("").reduce((a, c) => a + parseInt(c, 16), 0);
}

function vote(v) {
  return Math.abs(parseInt(v)) % 2 === 0 ? "TAI" : "XIU";
}

/* ========================= FORMULAS ========================= */
function f2(md5) {
  let a = parseInt(md5.slice(0, 8), 16);
  let b = parseInt(md5.slice(8, 16), 16);
  let c = parseInt(md5.slice(16, 24), 16);
  let d = parseInt(md5.slice(24), 16);
  return ((a ^ b) + (c & d) - (a | d)) ^ ((b + c) << (a & 3));
}

function f3(md5) {
  let x = parseInt(md5.slice(0, 16), 16);
  let y = parseInt(md5.slice(16), 16);
  return (x * y + (x ^ y)) & 0xffffffff;
}

function f4(md5) {
  let h = crypto.createHash("sha256").update(md5).digest("hex");
  return parseInt(h.slice(0, 16), 16);
}

function f5(md5) {
  let h = crypto.createHash("sha1").update(md5).digest("hex");
  return parseInt(h.slice(0, 12), 16);
}

function f6(md5) {
  return (
    parseInt(md5.slice(0, 8), 16) +
    parseInt(md5.slice(8, 16), 16)
  ) ^
  (
    parseInt(md5.slice(16, 24), 16) +
    parseInt(md5.slice(24), 16)
  );
}

function f7(md5) {
  return md5.split("").reduce((a, c) => a + Math.pow(parseInt(c,16),2), 0);
}

/* ========================= AI ========================= */
function confidence(taiPct, xiuPct) {
  const diff = Math.abs(taiPct - xiuPct);
  if (diff < 5) return "LOW";
  if (diff < 15) return "MEDIUM";
  return "HIGH";
}

function predict(md5) {
  let tai = 0, xiu = 0;

  const formulas = [f2, f3, f4, f5, f6, f7];
  const algos = [entropyHex(md5)*100, bitDensity(md5), hexEnergy(md5)];

  formulas.forEach(f=>{
    vote(f(md5)) === "TAI" ? tai+=2 : xiu+=2;
  });

  algos.forEach(a=>{
    vote(a) === "TAI" ? tai+=1 : xiu+=1;
  });

  let total = tai + xiu;
  let taiPct = ((tai/total)*100).toFixed(1);
  let xiuPct = (100 - taiPct).toFixed(1);

  return {
    side: taiPct > xiuPct ? "TAI" : "XIU",
    taiPct,
    xiuPct,
    conf: confidence(taiPct, xiuPct)
  };
}

/* ========================= TREND ========================= */
function detectTrend(history) {
  if (history.length < 6) return "UNKNOWN";

  let last6 = history.slice(0,6).map(h=>h.ketqua);

  if (last6.every(v => v === last6[0])) return "CAU_BET";

  let zigzag = true;
  for (let i = 1; i < last6.length; i++) {
    if (last6[i] === last6[i-1]) zigzag = false;
  }

  if (zigzag) return "CAU_DAO";

  return "NORMAL";
}

function detectBreak(history, predictSide) {
  if (history.length < 3) return false;

  let last = history[0].ketqua;
  let prev = history[1].ketqua;

  return (last === prev && predictSide !== last);
}

/* ========================= CẦU ĐẸP ========================= */
function detectNiceTrend(history) {
  if (history.length < 5) return { status: false };

  let last5 = history.slice(0,5).map(h=>h.ketqua);

  let count = {};
  last5.forEach(v => count[v] = (count[v] || 0) + 1);

  for (let k in count) {
    if (count[k] >= 4) {
      return { status: true, type: "SAP_BET", goi_y: "SẮP BỆT" };
    }
  }

  let zigzag = true;
  for (let i = 1; i < last5.length; i++) {
    if (last5[i] === last5[i-1]) zigzag = false;
  }

  if (zigzag) {
    return { status: true, type: "SAP_DAO", goi_y: "ĐẢO ĐỀU" };
  }

  return { status: false };
}

/* ========================= BET ========================= */
function betSuggestion(conf, trend) {
  if (conf === "LOW") return "KHÔNG NÊN CHƠI";
  if (trend === "CAU_BET") return "ĐI NHẸ";
  if (trend === "CAU_DAO") return "ĐI ĐỀU";
  if (conf === "HIGH") return "CÓ THỂ TĂNG";
  return "ĐI NHẸ";
}

/* ========================= FETCH ========================= */
setInterval(async () => {
  try {
    const tx = await axios.get("https://wtx.macminim6.online/v1/tx/lite-sessions");
    const md5 = await axios.get("https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions");

    cacheTX = tx.data;
    cacheMD5 = md5.data;

    let last = md5.data.list[0];

    let md5hash = crypto.createHash("md5")
      .update(last._id)
      .digest("hex");

    let kq = predict(md5hash);

    let result = last.resultTruyenThong;
    let status = result ? (result === kq.side ? "WIN" : "LOSE") : null;

    history.unshift({
      phien: last.id,
      md5: md5hash,
      du_doan: kq.side,
      ketqua: result,
      trang_thai: status,
      time: Date.now()
    });

    if (history.length > 20) history.pop();

    if (last.id !== lastPhien) {
      lastPhien = last.id;

      if (result) {
        stats.total++;
        if (status === "WIN") stats.win++;
        else stats.lose++;
      }
    }

  } catch(e) {
    console.log("Fetch lỗi API");
  }
}, 1500);

/* ========================= COUNTDOWN ========================= */
setInterval(()=>{
  countdown--;
  if(countdown <= 0) countdown = 30;
},1000);

/* ========================= API ========================= */

// bàn thường
app.get("/taixiu", (req,res)=>{
  if (!cacheTX) return res.json({status:"loading"});
  let last = cacheTX.list?.[0];
  res.json({
    phien:last?.id,
    ketqua:last?.resultTruyenThong,
    countdown
  });
});

// bàn AI
app.get("/taixiumd5", (req,res)=>{
  if (!cacheMD5) return res.json({status:"loading"});

  let last = cacheMD5.list?.[0];
  let md5hash = crypto.createHash("md5").update(last._id).digest("hex");

  let kq = predict(md5hash);

  res.json({
    phien:last.id,
    du_doan:kq.side,
    tai:kq.taiPct+"%",
    xiu:kq.xiuPct+"%",
    do_tin_cay:kq.conf,
    countdown
  });
});

// alert
app.get("/alert",(req,res)=>{
  let nice = detectNiceTrend(history);
  res.json(nice);
});

// stats
app.get("/stats",(req,res)=>{
  let rate = stats.total>0?((stats.win/stats.total)*100).toFixed(1):0;
  res.json({...stats, winrate:rate+"%"});
});

// history live
app.get("/history-live",(req,res)=>{
  res.json(history);
});

// last
app.get("/last",(req,res)=>{
  res.json(history[0]||{});
});

// stream
app.get("/stream",(req,res)=>{
  res.setHeader("Content-Type","text/plain");
  let i = setInterval(()=>{
    if(history[0]) res.write(JSON.stringify(history[0])+"\n");
  },1500);
  req.on("close",()=>clearInterval(i));
});

// all
app.get("/all",(req,res)=>{
  res.json({
    history,
    stats,
    last:history[0]||null,
    countdown
  });
});

/* ========================= */
app.listen(PORT, ()=>console.log("RUN PORT "+PORT));
