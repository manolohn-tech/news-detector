import { useState, useEffect, useRef, useCallback } from "react";

/* ══════════════════════════════════════════════════════════════════
   VERIDECT v5 — AI Fake News Detector
   Drop this file into your Vite/CRA project as App.jsx
   Also paste this into your index.css:
     *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
     html, body, #root { width: 100%; min-height: 100vh; overflow-x: hidden; }
══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   ▶ VERCEL DEPLOYMENT — NO CHANGES NEEDED HERE
   This points to /api/proxy which Vercel serves automatically.
   Just deploy to Vercel and add ANTHROPIC_API_KEY env variable.
   See SETUP.md for full instructions (3 minutes).
══════════════════════════════════════════════════════════════ */
const PROXY_URL = "/api/proxy";

/* ── Palette ─────────────────────────────────────────────────── */
const C = {
  bg:"#04060f", bg1:"#080c1a", bg2:"#0c1120", bg3:"#111726",
  line:"rgba(255,255,255,0.07)", lineHi:"rgba(255,255,255,0.13)",
  cyan:"#00f5d4", blue:"#3d9bff", green:"#00e676", red:"#ff3860",
  amber:"#ffb347", violet:"#c084fc", pink:"#f472b6",
  txt:"#dde3ff", sub:"#8892bb", muted:"#3d4870",
};

const VC = {
  REAL:       { col:C.green,  label:"VERIFIED REAL", icon:"✓" },
  FAKE:       { col:C.red,    label:"FAKE NEWS",      icon:"✗" },
  MISLEADING: { col:C.amber,  label:"MISLEADING",     icon:"⚠" },
  UNVERIFIED: { col:C.muted,  label:"UNVERIFIED",     icon:"?" },
  SATIRE:     { col:C.violet, label:"SATIRE",         icon:"☆" },
  PROPAGANDA: { col:C.pink,   label:"PROPAGANDA",     icon:"◉" },
  OUTDATED:   { col:C.blue,   label:"OUTDATED INFO",  icon:"⏱" },
};

const RISK_COL = { LOW:C.green, MEDIUM:C.amber, HIGH:C.red, CRITICAL:"#ff0040" };

const TABS = ["Overview","Claims","Bias & Mood","Language","Raw Data"];

const POPUP_STEPS = [
  { icon:"📄", label:"Reading your content" },
  { icon:"🌐", label:"Searching the live web" },
  { icon:"🔎", label:"Cross-referencing facts" },
  { icon:"⚡", label:"Compiling verdict" },
];

const TICKER = "SEARCHING LIVE WEB  ·  VERIFYING FACTS  ·  SCANNING ARCHIVES  ·  CHECKING SOURCES  ·  DETECTING BIAS  ·  LIVE FACT-CHECK ACTIVE  ·  QUERYING NEWS DATABASES  ·  ";

/* ── System prompt ────────────────────────────────────────────── */
const SYS = `You are an expert fact-checker and investigative journalist with live web search.

SCORING RULES — be FAIR and ACCURATE:
- Score 85-100: Confirmed by multiple credible sources (BBC, Reuters, AP, official sites)
- Score 65-84: Confirmed by 1-2 credible sources with minor gaps
- Score 40-64: Partially true, missing context, or only 1 source found
- Score 15-39: Contradicted by credible sources or major red flags
- Score 0-14: Definitively false, debunked by credible fact-checkers
- If content is from a credible known outlet (BBC, CNN, Reuters, Times, etc.) START with score 70+ and adjust based on specific claims
- NEVER give low scores just because you couldn't search — mark as UNVERIFIED with medium score instead

SEARCH RULES:
- Search 3-5 times: first for the main claim, then for the source credibility, then for contradicting evidence
- For URLs: search the headline/topic extracted from the URL, search the publication name + credibility, search for fact-checks of the specific story
- For text: extract 2-3 key claims and search each one separately
- Always check if the SOURCE ITSELF is credible (established newspaper vs unknown blog)

OUTPUT: ONLY valid JSON — no text outside JSON, no markdown fences.

JSON schema:
{
  "verdict":"REAL"|"FAKE"|"MISLEADING"|"UNVERIFIED"|"SATIRE"|"PROPAGANDA"|"OUTDATED",
  "score":<0-100>,
  "confidence":<0-100>,
  "credibility":<0-100>,
  "manipulation":<0-100>,
  "risk":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "category":"Politics"|"Health"|"Science"|"Finance"|"Sports"|"Entertainment"|"Crime"|"Tech"|"History"|"Other",
  "when":"<timeframe e.g. March 2025>",
  "headline":"<punchy 8-word verdict headline>",
  "summary":"<3 sentences: what was found, what sources say, final assessment>",
  "evidence":"<detailed facts found online with specific source names and what they say>",
  "score_reason":"<1-2 sentences explaining exactly WHY this score was given>",
  "action":"<specific actionable advice for the reader>",
  "source_credibility":"<assessment of the original source's reputation and reliability>",
  "flags":["<specific red flag>","<specific red flag>","<specific red flag>"],
  "signals":["<specific positive signal>","<specific positive signal>"],
  "findings":["<key verified finding>","<key verified finding>","<key verified finding>","<key verified finding>"],
  "dims":{"Factual":<0-100>,"Sources":<0-100>,"Logic":<0-100>,"Context":<0-100>,"Language":<0-100>},
  "bias":{"dir":"Far Left"|"Left"|"Center-Left"|"Center"|"Center-Right"|"Right"|"Far Right","score":<-100 to 100>,"note":"<1 sentence about bias>"},
  "mood":{"tone":"Positive"|"Negative"|"Neutral"|"Mixed","emotion":"Fear"|"Anger"|"Hope"|"Neutral"|"Disgust"|"Excitement","tactics":["<specific manipulation tactic if any>"]},
  "lang":{"clickbait":<0-100>,"sensational":<0-100>,"emotional":<0-100>,"complex":<0-100>,"hot":["<power word>"],"hedge":["<hedge word>"]},
  "claims":[{"text":"<specific verifiable claim>","verdict":"TRUE"|"FALSE"|"MISLEADING"|"UNVERIFIED","proof":"<exact evidence from web search>","pct":<0-100>}],
  "wiki_topic":"<main Wikipedia search term for this topic>",
  "searched":["<exact query 1>","<exact query 2>","<exact query 3>"]
}`;

/* ── Helpers ──────────────────────────────────────────────────── */
const lerp = (a, b, t) => a + (b - a) * t;

function grabJSON(raw) {
  const s = raw.replace(/```json/gi,"").replace(/```/g,"").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("No JSON found");
  return JSON.parse(s.slice(a, b + 1));
}

function buildVerifyLinks(result) {
  const topic = (result.wiki_topic || result.headline || result.category || "news").trim();
  const q = encodeURIComponent(topic);
  const links = [
    { name:"Wikipedia",          url:`https://en.wikipedia.org/w/index.php?search=${q}`, icon:"📖", type:"wiki" },
    { name:"Google News",        url:`https://news.google.com/search?q=${q}`,             icon:"📰", type:"news" },
    { name:"Snopes",             url:`https://www.snopes.com/search/?q=${q}`,             icon:"🔍", type:"factcheck" },
    { name:"Reuters Fact Check", url:`https://www.reuters.com/fact-check/?search=${q}`,   icon:"📡", type:"factcheck" },
    { name:"PolitiFact",         url:`https://www.politifact.com/search/?q=${q}`,         icon:"⚖️", type:"factcheck" },
    { name:"FactCheck.org",      url:`https://www.factcheck.org/?s=${q}`,                 icon:"✅", type:"factcheck" },
  ];
  const cat = (result.category || "").toLowerCase();
  if (cat==="health"||cat==="science") {
    links.push({ name:"PubMed", url:`https://pubmed.ncbi.nlm.nih.gov/?term=${q}`, icon:"🧬", type:"official" });
    links.push({ name:"WHO",    url:`https://www.who.int/search?query=${q}`,       icon:"🌍", type:"official" });
  }
  if (cat==="politics") links.push({ name:"AllSides",   url:`https://www.allsides.com/search/node/${q}`,   icon:"🏛️", type:"news" });
  if (cat==="sports")   { links.push({ name:"ESPN",     url:`https://www.espn.com/search/_/q/${q}`,        icon:"🏆", type:"news" }); links.push({ name:"BBC Sport", url:`https://www.bbc.com/sport/search?q=${q}`, icon:"⚽", type:"news" }); }
  if (cat==="finance")  links.push({ name:"Reuters",    url:`https://www.reuters.com/search/news?blob=${q}`,icon:"💹", type:"news" });
  if (cat==="tech")     links.push({ name:"TechCrunch", url:`https://techcrunch.com/search/${q}`,           icon:"💻", type:"news" });
  return links;
}

/* ══════════════════════════════════════════════════════════════
   SMALL SHARED COMPONENTS
══════════════════════════════════════════════════════════════ */

function Pill({ label, col = C.blue }) {
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", padding:"3px 10px",
      borderRadius:999, fontSize:10, fontWeight:700,
      fontFamily:"'IBM Plex Mono',monospace", letterSpacing:.8,
      textTransform:"uppercase", whiteSpace:"nowrap",
      color:col, background:`${col}18`, border:`1px solid ${col}44`,
    }}>{label}</span>
  );
}

function SL({ label, col = C.muted }) {
  return (
    <div style={{
      fontSize:9, color:col, letterSpacing:3, textTransform:"uppercase",
      fontWeight:700, marginBottom:14, fontFamily:"'IBM Plex Mono',monospace",
      display:"flex", alignItems:"center", gap:8,
    }}>
      <span style={{ width:20, height:1.5, background:col, display:"inline-block" }} />
      {label}
    </div>
  );
}

function Card({ children, accent, style: s = {} }) {
  return (
    <div style={{
      background:C.bg2, border:`1px solid ${accent ? accent+"33" : C.line}`,
      borderRadius:14, padding:20,
      boxShadow: accent ? `0 0 40px ${accent}0d` : "none", ...s,
    }}>{children}</div>
  );
}

function Num({ to = 0, ms = 900, col = C.txt, sz = 22, unit = "%" }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf, t0;
    const run = ts => {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / ms, 1);
      setV(Math.round(lerp(0, to, 1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <span style={{ fontFamily:"'Chakra Petch',sans-serif", fontSize:sz, color:col, fontWeight:700 }}>{v}{unit}</span>;
}

function Arc({ v = 0, sz = 152 }) {
  const R = (sz - 14) / 2, cx = sz / 2;
  const circ = 2 * Math.PI * R, arc = circ * 0.75;
  const col = v >= 70 ? C.green : v >= 40 ? C.amber : C.red;
  return (
    <svg width={sz} height={sz} style={{ overflow:"visible" }}>
      <circle cx={cx} cy={cx} r={R} fill="none" stroke={C.line} strokeWidth="10"
        strokeDasharray={`${arc} ${circ}`} strokeLinecap="round"
        style={{ transform:"rotate(135deg)", transformOrigin:`${cx}px ${cx}px` }} />
      <circle cx={cx} cy={cx} r={R} fill="none" stroke={col} strokeWidth="10"
        strokeDasharray={`${arc * v / 100} ${circ}`} strokeLinecap="round"
        style={{ transform:"rotate(135deg)", transformOrigin:`${cx}px ${cx}px`,
          filter:`drop-shadow(0 0 8px ${col})`,
          transition:"stroke-dasharray 1.3s cubic-bezier(.4,0,.2,1)" }} />
      <text x={cx} y={cx - 6} textAnchor="middle" fill={col}
        fontSize={sz * 0.22} fontWeight="700" fontFamily="'Chakra Petch',sans-serif">{v}</text>
      <text x={cx} y={cx + 14} textAnchor="middle" fill={C.muted}
        fontSize={sz * 0.08} fontFamily="'IBM Plex Mono',monospace" letterSpacing="1.5">TRUTH SCORE</text>
    </svg>
  );
}

function Spider({ dims }) {
  const e = Object.entries(dims || {});
  if (!e.length) return null;
  const n = e.length, cx = 100, cy = 100, R = 72;
  const pt = (i, r) => { const a = i * 2 * Math.PI / n - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  return (
    <svg width={200} height={200}>
      {[.33, .66, 1].map(l => <polygon key={l} fill="none" stroke={C.line} strokeWidth="1" points={e.map((_,i) => pt(i, R*l).join(",")).join(" ")} />)}
      {e.map((_, i) => { const [x,y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={C.line} strokeWidth="1" />; })}
      <polygon points={e.map(([,v],i) => pt(i, R*v/100).join(",")).join(" ")}
        fill={`${C.cyan}18`} stroke={C.cyan} strokeWidth="2"
        style={{ filter:`drop-shadow(0 0 6px ${C.cyan}66)` }} />
      {e.map(([,v],i) => { const [x,y] = pt(i, R*v/100); return <circle key={i} cx={x} cy={y} r="4" fill={C.cyan} />; })}
      {e.map(([k],i) => { const [x,y] = pt(i, R+22); return (
        <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
          fill={C.sub} fontSize="9" fontFamily="'IBM Plex Mono',monospace">{k}</text>
      ); })}
    </svg>
  );
}

function Bar({ label, val = 0, col, icon = "", delay = 0 }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW(val), delay + 60); return () => clearTimeout(t); }, [val, delay]);
  const c = col || (val >= 70 ? C.green : val >= 40 ? C.amber : C.red);
  return (
    <div style={{ marginBottom:11 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontSize:11.5, color:C.sub, fontFamily:"'IBM Plex Mono',monospace" }}>{icon} {label}</span>
        <span style={{ fontSize:11.5, color:c, fontWeight:700, fontFamily:"'Chakra Petch',sans-serif" }}>{val}%</span>
      </div>
      <div style={{ height:3, background:C.line, borderRadius:99 }}>
        <div style={{ height:"100%", width:`${w}%`, borderRadius:99,
          background:`linear-gradient(90deg,${c}77,${c})`,
          boxShadow:`0 0 8px ${c}55`,
          transition:`width 1.1s cubic-bezier(.4,0,.2,1) ${delay}ms` }} />
      </div>
    </div>
  );
}

function BiasBar({ score = 0, dir = "Center" }) {
  const pct = Math.min(100, Math.max(0, (score + 100) / 2));
  const c = Math.abs(score) > 55 ? C.red : Math.abs(score) > 25 ? C.amber : C.green;
  return (
    <div>
      <div style={{ position:"relative", height:16, borderRadius:8, overflow:"hidden",
        marginBottom:7, background:"linear-gradient(90deg,#1a44ff,#0a0a22,#ff1a44)" }}>
        <div style={{ position:"absolute", top:2, bottom:2, width:12, borderRadius:6,
          background:"#fff", boxShadow:"0 0 8px rgba(255,255,255,.8)",
          left:`calc(${pct}% - 6px)`, transition:"left 1.4s cubic-bezier(.4,0,.2,1)" }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
        {["Far Left","","Center","","Far Right"].map((l,i) => (
          <span key={i} style={{ fontSize:9, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>{l}</span>
        ))}
      </div>
      <div style={{ textAlign:"center" }}><Pill label={dir} col={c} /></div>
    </div>
  );
}

function ClaimRow({ c }) {
  const [open, setOpen] = useState(false);
  const map = { TRUE:C.green, FALSE:C.red, MISLEADING:C.amber, UNVERIFIED:C.muted };
  const ico = { TRUE:"✓", FALSE:"✗", MISLEADING:"~", UNVERIFIED:"?" };
  const col = map[c.verdict] || C.muted;
  return (
    <div onClick={() => setOpen(o => !o)}
      style={{ padding:"12px 0", borderBottom:`1px solid ${C.line}`, cursor:"pointer" }}>
      <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
        <span style={{ fontSize:14, fontWeight:700, color:col, flexShrink:0, width:18,
          fontFamily:"'Chakra Petch',sans-serif" }}>{ico[c.verdict] || "?"}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12.5, color:C.txt, lineHeight:1.65,
            fontFamily:"'IBM Plex Mono',monospace" }}>{c.text}</div>
          {open && (
            <div style={{ marginTop:9, fontSize:11.5, color:C.sub, lineHeight:1.75,
              padding:"9px 13px", background:`${col}0d`,
              borderLeft:`3px solid ${col}`, borderRadius:"0 6px 6px 0",
              fontFamily:"'IBM Plex Mono',monospace" }}>
              {c.proof}
              {c.pct != null && <span style={{ color:col, fontWeight:700, marginLeft:8 }}>({c.pct}% confident)</span>}
            </div>
          )}
        </div>
        <Pill label={c.verdict} col={col} />
      </div>
    </div>
  );
}

/* ── Verify Links ─────────────────────────────────────────────── */
const TYPE_STYLE = {
  wiki:      { col:"#60a5fa", label:"WIKI" },
  factcheck: { col:"#34d399", label:"FACT-CHECK" },
  news:      { col:"#fbbf24", label:"NEWS" },
  official:  { col:"#c084fc", label:"OFFICIAL" },
};

function VerifyLinks({ result }) {
  const links = buildVerifyLinks(result);
  const q = encodeURIComponent((result.wiki_topic || result.headline || result.category || "news").trim());
  const groups = {};
  links.filter(l => l.type !== "wiki").forEach(l => {
    if (!groups[l.type]) groups[l.type] = [];
    groups[l.type].push(l);
  });
  return (
    <div>
      {/* Wikipedia featured */}
      <a href={`https://en.wikipedia.org/w/index.php?search=${q}`} target="_blank" rel="noopener noreferrer"
        style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 16px", marginBottom:14,
          borderRadius:10, textDecoration:"none",
          background:"rgba(96,165,250,0.07)", border:"1.5px solid rgba(96,165,250,0.25)",
          transition:"all .2s" }}
        onMouseEnter={e => { e.currentTarget.style.background="rgba(96,165,250,0.14)"; e.currentTarget.style.borderColor="rgba(96,165,250,0.55)"; }}
        onMouseLeave={e => { e.currentTarget.style.background="rgba(96,165,250,0.07)"; e.currentTarget.style.borderColor="rgba(96,165,250,0.25)"; }}>
        <div style={{ width:40, height:40, borderRadius:8, background:"rgba(96,165,250,0.15)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>📖</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#60a5fa",
            fontFamily:"'Chakra Petch',sans-serif", marginBottom:3 }}>
            Wikipedia — "{result.wiki_topic || result.category || "this topic"}"
          </div>
          <div style={{ fontSize:10.5, color:C.sub, fontFamily:"'IBM Plex Mono',monospace" }}>
            en.wikipedia.org · Click to search Wikipedia for this topic
          </div>
        </div>
        <span style={{ fontSize:11, color:"#60a5fa", fontFamily:"'IBM Plex Mono',monospace",
          padding:"3px 9px", background:"rgba(96,165,250,0.12)", borderRadius:4, flexShrink:0 }}>↗ Open</span>
      </a>

      {/* Grouped links */}
      {Object.entries(groups).map(([type, items]) => {
        const ts = TYPE_STYLE[type] || TYPE_STYLE.news;
        return (
          <div key={type} style={{ marginBottom:14 }}>
            <SL label={ts.label} col={ts.col} />
            <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
              {items.map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                  style={{ display:"inline-flex", alignItems:"center", gap:7,
                    padding:"7px 13px", borderRadius:8, textDecoration:"none",
                    background:`${ts.col}10`, border:`1px solid ${ts.col}33`,
                    color:ts.col, fontSize:11.5, fontFamily:"'IBM Plex Mono',monospace",
                    transition:"all .18s" }}
                  onMouseEnter={e => { e.currentTarget.style.background=`${ts.col}22`; e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow=`0 4px 16px ${ts.col}22`; }}
                  onMouseLeave={e => { e.currentTarget.style.background=`${ts.col}10`; e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="none"; }}>
                  <span style={{ fontSize:13 }}>{link.icon}</span>
                  {link.name}
                  <span style={{ fontSize:9, opacity:.6 }}>↗</span>
                </a>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{ marginTop:8, fontSize:10, color:C.muted, fontFamily:"'IBM Plex Mono',monospace", lineHeight:1.6 }}>
        💡 All links open the actual website pre-searched for your specific topic. Always cross-reference multiple sources.
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SEARCH POPUP
══════════════════════════════════════════════════════════════ */
function SearchPopup({ step, queries }) {
  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9999,
      display:"flex", alignItems:"center", justifyContent:"center",
      background:"rgba(4,6,15,0.92)", backdropFilter:"blur(18px)",
      animation:"overlayFade .25s ease",
    }}>
      <div style={{
        width:"min(540px,95vw)", borderRadius:20, overflow:"hidden",
        background:`linear-gradient(150deg,${C.bg1},${C.bg2})`,
        border:`1px solid ${C.cyan}44`,
        boxShadow:`0 0 100px ${C.cyan}18,0 40px 100px rgba(0,0,0,.8)`,
        animation:"cardPop .4s cubic-bezier(.34,1.56,.64,1)",
      }}>

        {/* ticker */}
        <div style={{ overflow:"hidden", background:`${C.cyan}0e`, borderBottom:`1px solid ${C.cyan}22`, padding:"5px 0" }}>
          <div style={{ display:"flex", whiteSpace:"nowrap", animation:"tickerScroll 22s linear infinite" }}>
            {[0,1,2].map(i => (
              <span key={i} style={{ fontSize:8.5, color:C.cyan, letterSpacing:3, fontWeight:700,
                fontFamily:"'IBM Plex Mono',monospace", paddingRight:60 }}>{TICKER}</span>
            ))}
          </div>
        </div>

        <div style={{ padding:"28px 28px 24px" }}>

          {/* radar + title */}
          <div style={{ display:"flex", alignItems:"center", gap:18, marginBottom:26 }}>
            <div style={{ position:"relative", width:72, height:72, flexShrink:0 }}>
              <svg width="72" height="72" style={{ position:"absolute", inset:0 }}>
                {[28,19,10].map((r,i) => (
                  <circle key={i} cx="36" cy="36" r={r} fill="none"
                    stroke={`${C.cyan}${["18","25","38"][i]}`} strokeWidth="1.5" />
                ))}
              </svg>
              <div style={{ position:"absolute", inset:0,
                background:`conic-gradient(from 0deg,${C.cyan}44 0deg,transparent 70deg)`,
                borderRadius:"50%", animation:"radarSpin 2.4s linear infinite" }} />
              <svg width="72" height="72" style={{ position:"absolute", inset:0, animation:"radarSpin 2.4s linear infinite" }}>
                <line x1="36" y1="36" x2="62" y2="36" stroke={C.cyan} strokeWidth="2"
                  strokeLinecap="round" style={{ filter:`drop-shadow(0 0 4px ${C.cyan})` }} />
              </svg>
              <div style={{ position:"absolute", top:"50%", left:"50%",
                width:8, height:8, borderRadius:"50%", background:C.cyan,
                transform:"translate(-50%,-50%)",
                boxShadow:`0 0 14px ${C.cyan}`, animation:"gPulse 1.4s ease infinite" }} />
            </div>
            <div>
              <div style={{ fontSize:21, fontWeight:700, color:C.txt, letterSpacing:-.5,
                lineHeight:1.1, marginBottom:6, fontFamily:"'Chakra Petch',sans-serif" }}>
                Searching Live Web
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:C.green,
                  animation:"gPulse 1s ease infinite", boxShadow:`0 0 8px ${C.green}`,
                  display:"inline-block", flexShrink:0 }} />
                <span style={{ fontSize:11, color:C.sub, fontFamily:"'IBM Plex Mono',monospace" }}>
                  Real-time fact verification in progress
                </span>
              </div>
            </div>
          </div>

          {/* steps */}
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
            {POPUP_STEPS.map((s, i) => {
              const done = step > i, active = step === i;
              return (
                <div key={i} style={{
                  display:"flex", alignItems:"center", gap:12,
                  padding:"10px 14px", borderRadius:10,
                  background: done?`${C.cyan}0c`:active?`${C.blue}0c`:`rgba(255,255,255,.02)`,
                  border:`1px solid ${done?C.cyan+"33":active?C.blue+"33":"transparent"}`,
                  transition:"all .5s ease",
                }}>
                  <div style={{
                    width:30, height:30, borderRadius:"50%", flexShrink:0,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize: done ? 13 : 14,
                    background: done?C.cyan:active?`${C.blue}33`:`rgba(255,255,255,.04)`,
                    border:`1.5px solid ${done?C.cyan:active?C.blue:C.line}`,
                    color: done?C.bg:C.txt, fontWeight:700, transition:"all .5s ease",
                  }}>
                    {done ? "✓" : active ? (
                      <span style={{ width:8, height:8, borderRadius:"50%",
                        background:C.blue, animation:"gPulse .8s ease infinite",
                        display:"inline-block" }} />
                    ) : s.icon}
                  </div>
                  <div style={{ flex:1, fontSize:12.5, fontWeight:600,
                    color: done?C.cyan:active?C.txt:C.muted,
                    fontFamily:"'Chakra Petch',sans-serif", transition:"color .5s" }}>
                    {s.label}{active ? "…" : ""}
                  </div>
                  {done && <span style={{ fontSize:9, color:C.cyan, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1 }}>DONE</span>}
                  {active && (
                    <svg width="16" height="16" style={{ animation:"spinIcon .65s linear infinite", flexShrink:0 }}>
                      <circle cx="8" cy="8" r="6" fill="none" stroke={`${C.blue}44`} strokeWidth="2" />
                      <circle cx="8" cy="8" r="6" fill="none" stroke={C.blue} strokeWidth="2"
                        strokeDasharray="10 28" strokeLinecap="round" />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>

          {/* live queries */}
          {queries.length > 0 && (
            <div style={{ padding:"11px 14px", borderRadius:10,
              background:`${C.cyan}08`, border:`1px solid ${C.cyan}22`, marginBottom:16 }}>
              <div style={{ fontSize:8.5, color:C.cyan, letterSpacing:3, fontWeight:700,
                textTransform:"uppercase", fontFamily:"'IBM Plex Mono',monospace", marginBottom:8 }}>
                🔍 Live search queries
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {queries.map((q, i) => (
                  <span key={i} style={{ fontSize:10.5, color:C.sub, padding:"3px 10px",
                    background:"rgba(255,255,255,.04)", border:`1px solid ${C.line}`,
                    borderRadius:99, fontFamily:"'IBM Plex Mono',monospace", fontStyle:"italic" }}>
                    "{q}"
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* progress */}
          <div style={{ height:3, background:C.line, borderRadius:99, overflow:"hidden", marginBottom:12 }}>
            <div style={{ height:"100%", borderRadius:99,
              background:`linear-gradient(90deg,${C.blue},${C.cyan})`,
              boxShadow:`0 0 10px ${C.cyan}88`,
              width:`${[5,30,65,88][Math.min(step,3)]}%`,
              transition:"width .8s cubic-bezier(.4,0,.2,1)" }} />
          </div>
          <div style={{ textAlign:"center", fontSize:10, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>
            Searching real websites · typically 8–18 seconds
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════ */
export default function App() {
  const [input,   setInput]   = useState("");
  const [mode,    setMode]    = useState("text");
  const [loading, setLoading] = useState(false);
  const [step,    setStep]    = useState(0);
  const [queries, setQueries] = useState([]);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);
  const [tab,     setTab]     = useState("Overview");
  const [history, setHistory] = useState([]);
  const [showH,   setShowH]   = useState(false);

  /* step ticker tied to loading */
  useEffect(() => {
    if (!loading) { setStep(0); return; }
    setStep(0);
    const t1 = setTimeout(() => setStep(1), 1000);
    const t2 = setTimeout(() => setStep(2), 4500);
    const t3 = setTimeout(() => setStep(3), 8000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [loading]);

  /* keyboard shortcut */
  useEffect(() => {
    const h = e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") analyse(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const analyse = useCallback(async () => {
    const raw = input.trim();
    if (!raw || loading) return;

    // Auto-detect URL
    const isURL = /^https?:\/\//i.test(raw) || /^www\./i.test(raw);
    if (isURL && mode !== "url") setMode("url");

    // Validate
    if (!isURL && raw.split(/\s+/).length < 5) {
      setError("Please enter at least a few words or a full URL to analyse.");
      return;
    }
    const urlToCheck = isURL ? (raw.startsWith("http") ? raw : "https://" + raw) : null;

    setLoading(true); setError(null); setResult(null);
    setQueries([]); setTab("Overview");

    // Build a rich prompt depending on mode
    const msg = isURL
      ? `You are fact-checking this news article URL: ${urlToCheck}

INSTRUCTIONS FOR URL MODE:
1. Use web_search to search for the exact URL or its headline to find what this article says
2. Search for the publication name to assess its credibility (e.g. "BBC News credibility", "is [site] reliable")
3. Search for the key claims in the article to verify them against other sources
4. Search for any fact-checks or rebuttals of this specific story
5. Give a FAIR score: if it's from a known credible outlet covering a real event, score should be 75+

The URL is: ${urlToCheck}`
      : `You are fact-checking the following text/article. Analyse it thoroughly.

INSTRUCTIONS FOR TEXT MODE:
1. Identify the 2-3 most important factual claims in the text
2. Search the web for each key claim to verify it
3. Search for the source/author credibility if identifiable
4. Look for contradicting or supporting evidence
5. Give a FAIR and ACCURATE score based purely on what you find

TEXT TO FACT-CHECK:
---
${raw}
---`;

    try {
      /* Pass 1 */
      const r1 = await fetch(PROXY_URL, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:4096, system:SYS,
          tools:[{ type:"web_search_20250305", name:"web_search" }],
          messages:[{ role:"user", content:msg }],
        }),
      });
      if (!r1.ok) { const e = await r1.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${r1.status}`); }
      const d1 = await r1.json();
      const blocks1 = d1.content || [];

      blocks1.filter(b => b.type==="tool_use" && b.name==="web_search" && b.input?.query)
             .forEach(b => setQueries(q => [...new Set([...q, b.input.query])]));

      const raw1 = blocks1.map(b => b.text||"").join("").trim();
      let parsed = null;
      if (raw1) { try { parsed = grabJSON(raw1); } catch(_) {} }

      /* Pass 2 — handle tool_use midpoint OR end_turn with no parseable JSON */
      if (!parsed && (d1.stop_reason === "tool_use" || d1.stop_reason === "end_turn")) {
        const toolBlocks = blocks1.filter(b => b.type === "tool_use");
        const r2 = await fetch(PROXY_URL, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body:JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:4096, system:SYS,
            tools:[{ type:"web_search_20250305", name:"web_search" }],
            messages:[
              { role:"user", content:msg },
              { role:"assistant", content:blocks1 },
              { role:"user", content:toolBlocks.map(b => ({
                  type:"tool_result", tool_use_id:b.id,
                  content:"Search done. Output ONLY the JSON verdict now.",
                })) },
            ],
          }),
        });
        if (!r2.ok) { const e = await r2.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${r2.status}`); }
        const d2 = await r2.json();
        parsed = grabJSON((d2.content||[]).map(b=>b.text||"").join("").trim());
      }

      if (!parsed) throw new Error("Could not parse the analysis result. Please try again.");

      setResult(parsed);
      setHistory(h => [{
        id:Date.now(),
        preview:input.slice(0,65)+(input.length>65?"…":""),
        verdict:parsed.verdict, score:parsed.score,
        ts:new Date().toLocaleTimeString(), input,
      }, ...h.slice(0,19)]);

    } catch(e) {
      let msg = e.message || "Something went wrong. Please try again.";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("CORS")) {
        msg = "Connection failed. Check that your proxy URL is set correctly in veridect.jsx (PROXY_URL constant at the top of the file).";
      } else if (msg.includes("401") || msg.includes("invalid_api_key") || msg.includes("authentication")) {
        msg = "Invalid API key. Please check your key at console.anthropic.com — it should start with sk-ant-api03-";
      } else if (msg.includes("429") || msg.includes("rate_limit")) {
        msg = "Rate limit hit. Please wait 30 seconds and try again, or check your usage limits at console.anthropic.com";
      } else if (msg.includes("insufficient_quota") || msg.includes("credit")) {
        msg = "Insufficient API credits. Please add credits at console.anthropic.com/billing";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [input, loading, mode]);

  const vc = result ? (VC[result.verdict] || VC.UNVERIFIED) : null;

  return (
    <div style={{
      width:"100vw", minHeight:"100vh", overflowX:"hidden",
      background:C.bg, color:C.txt, fontFamily:"'Chakra Petch',sans-serif",
      backgroundImage:`
        radial-gradient(ellipse 70% 45% at 20% 0%,rgba(0,245,212,.06) 0%,transparent 55%),
        radial-gradient(ellipse 60% 50% at 80% 100%,rgba(61,155,255,.07) 0%,transparent 55%)`,
    }}>

      {/* ── Global styles ─────────────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { width: 100% !important; max-width: 100% !important; overflow-x: hidden !important; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: #04060f; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 4px; }

        @keyframes overlayFade  { from{opacity:0} to{opacity:1} }
        @keyframes cardPop      { from{opacity:0;transform:scale(.88) translateY(28px)} to{opacity:1;transform:none} }
        @keyframes tickerScroll { 0%{transform:translateX(0)} 100%{transform:translateX(-33.33%)} }
        @keyframes radarSpin    { to{transform:rotate(360deg)} }
        @keyframes spinIcon     { to{transform:rotate(360deg)} }
        @keyframes gPulse       { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.35;transform:scale(.65)} }
        @keyframes fadeUp       { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        @keyframes glowLine     { 0%,100%{opacity:.3} 50%{opacity:.8} }

        .reveal   { animation: fadeUp .45s ease both; }
        .g2       { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
        @media (max-width:620px) { .g2 { grid-template-columns:1fr; } }
        .full-span { grid-column:1/-1; }

        .abtn { transition:all .22s; }
        .abtn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 10px 36px rgba(0,245,212,.3) !important; }
        .abtn:active:not(:disabled) { transform:translateY(0); }

        textarea:focus, button:focus { outline:none; }
      `}</style>

      {/* ── Popup ─────────────────────────────────────────────── */}
      {loading && <SearchPopup step={step} queries={queries} />}

      <div style={{ width:"100%", padding:"0 40px 64px" }}>

        {/* ── Header ────────────────────────────────────────────── */}
        <header style={{ padding:"36px 0 28px", textAlign:"center" }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:16, marginBottom:14 }}>
            <svg width="52" height="52" viewBox="0 0 52 52">
              <polygon points="26,3 49,14.5 49,37.5 26,49 3,37.5 3,14.5"
                fill="none" stroke={C.cyan} strokeWidth="1.5"
                style={{ filter:`drop-shadow(0 0 8px ${C.cyan})` }} />
              <polygon points="26,10 42,18.5 42,33.5 26,42 10,33.5 10,18.5"
                fill={`${C.cyan}0f`} stroke={`${C.cyan}44`} strokeWidth="1" />
              <text x="26" y="30" textAnchor="middle" fill={C.cyan}
                fontSize="13" fontWeight="700" fontFamily="'Chakra Petch',sans-serif">V</text>
            </svg>
            <h1 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, letterSpacing:2, lineHeight:1, color:C.txt }}>
              VERI<span style={{ color:C.cyan }}>DECT</span>
            </h1>
          </div>
          <p style={{ fontSize:12, color:C.sub, letterSpacing:3, marginBottom:18,
            fontFamily:"'IBM Plex Mono',monospace", textTransform:"uppercase" }}>
            AI Fact Intelligence · Live Web Search · Any Era · Any Topic
          </p>
          <div style={{ display:"flex", justifyContent:"center", gap:8, flexWrap:"wrap" }}>
            {[
              { i:"🌐", l:"Live Web Search", c:C.cyan  },
              { i:"📅", l:"All-Era Coverage",c:C.blue  },
              { i:"⚡", l:"Fast Detection",  c:C.amber },
              { i:"🔬", l:"Deep Analysis",   c:C.violet},
              { i:"🌍", l:"Any Language",    c:C.green },
            ].map(f => (
              <div key={f.l} style={{ display:"flex", alignItems:"center", gap:6,
                padding:"5px 14px", borderRadius:999,
                background:`${f.c}10`, border:`1px solid ${f.c}30`,
                fontSize:11, color:f.c, fontWeight:600,
                fontFamily:"'IBM Plex Mono',monospace" }}>
                {f.i} {f.l}
              </div>
            ))}
          </div>
        </header>

        {/* glow rule */}
        <div style={{ height:1, background:`linear-gradient(90deg,transparent,${C.cyan}44,transparent)`,
          marginBottom:24, animation:"glowLine 3s ease infinite" }} />



        {/* ── Input Card ──────────────────────────────────────────── */}
        <div style={{ background:C.bg2, border:`1px solid ${C.line}`, borderRadius:14,
          padding:20, marginBottom:14 }}>

          {/* mode toggle + history */}
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
            {[{id:"text",i:"📝",l:"Text / Article"},{id:"url",i:"🔗",l:"URL / Link ↗"}].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                padding:"7px 16px", borderRadius:8, cursor:"pointer",
                fontSize:11.5, fontWeight:600, fontFamily:"'Chakra Petch',sans-serif",
                border:`1.5px solid ${mode===m.id?C.cyan:C.line}`,
                background: mode===m.id?`${C.cyan}12`:"transparent",
                color: mode===m.id?C.cyan:C.muted, transition:"all .2s",
              }}>{m.i} {m.l}</button>
            ))}
            <div style={{ flex:1 }} />
            <button onClick={() => setShowH(h => !h)} style={{
              padding:"7px 14px", borderRadius:8, fontSize:11, cursor:"pointer",
              border:`1px solid ${showH?C.blue+"55":C.line}`,
              background: showH?`${C.blue}10`:"transparent",
              color: showH?C.blue:C.muted, transition:"all .2s",
              fontFamily:"'IBM Plex Mono',monospace",
            }}>History [{history.length}]</button>
          </div>

          {/* textarea */}
          <div style={{ position:"relative", marginBottom:14 }}>
            <textarea rows={6} value={input} placeholder="Paste any news article, headline, tweet, WhatsApp forward, political claim, or URL…&#10;&#10;Supports: Full articles · Headlines · URLs · Any language · Any year"
              style={{ width:"100%", background:C.bg3, border:`1.5px solid ${C.line}`,
                borderRadius:10, padding:"13px 14px 32px", color:C.txt,
                fontSize:13, lineHeight:1.8, resize:"vertical",
                caretColor:C.cyan, transition:"border-color .2s",
                fontFamily:"'IBM Plex Mono',monospace" }}
              onFocus={e => e.target.style.borderColor=`${C.cyan}77`}
              onBlur={e  => e.target.style.borderColor=C.line}
              onChange={e => {
                setInput(e.target.value);
                const v = e.target.value.trim();
                if (/^https?:\/\//i.test(v) || /^www\./i.test(v)) setMode("url");
                else if (v.length > 0 && !/^https?:\/\//i.test(v)) setMode("text");
              }} />
            <div style={{ position:"absolute", bottom:10, right:14,
              fontSize:9.5, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>
              {input.length} chars
            </div>
          </div>

          {/* proxy not configured warning */}
          {false /* Vercel proxy configured */ && (
            <div style={{ padding:"14px 16px", marginBottom:14,
              background:"rgba(255,56,96,0.08)", border:"1px solid rgba(255,56,96,0.35)",
              borderRadius:10 }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.red, marginBottom:6,
                fontFamily:"'Chakra Petch',sans-serif" }}>⚠ Proxy URL Not Configured</div>
              <div style={{ fontSize:11.5, color:C.sub, lineHeight:1.8,
                fontFamily:"'IBM Plex Mono',monospace" }}>
                To use this app, deploy the Cloudflare Worker and update{" "}
                <span style={{ color:C.cyan }}>PROXY_URL</span> in veridect.jsx.<br/>
                See <span style={{ color:C.amber }}>cloudflare-worker.js</span> for step-by-step instructions (takes ~2 minutes).
              </div>
            </div>
          )}

          {/* live notice */}
          <div style={{ display:"flex", gap:10, padding:"10px 14px",
            background:`${C.cyan}08`, border:`1px solid ${C.cyan}22`,
            borderRadius:8, marginBottom:14, alignItems:"center" }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:C.green,
              animation:"gPulse 1.5s ease infinite", boxShadow:`0 0 8px ${C.green}`,
              display:"inline-block", flexShrink:0 }} />
            <div style={{ fontSize:12, color:C.sub, lineHeight:1.6, fontFamily:"'IBM Plex Mono',monospace" }}>
              <strong style={{ color:C.cyan }}>Live web search is ON. </strong>
              {mode==="url"
                ? "URL mode: AI will search the article topic, verify claims, and assess source credibility."
                : "Text mode: AI extracts key claims and cross-checks each one against live web sources."}
            </div>
          </div>

          {/* submit */}
          <button className="abtn" onClick={analyse} disabled={loading || !input.trim()} style={{
            width:"100%", padding:"15px 24px", borderRadius:10, border:"none",
            background: loading||!input.trim() ? C.bg3 : `linear-gradient(90deg,${C.blue},${C.cyan})`,
            color: loading||!input.trim() ? C.muted : C.bg,
            fontSize:14, fontWeight:700, letterSpacing:1, cursor: loading||!input.trim() ? "not-allowed" : "pointer",
            fontFamily:"'Chakra Petch',sans-serif",
            boxShadow: loading||!input.trim() ? "none" : `0 4px 28px ${C.cyan}44`,
          }}>
            {loading ? (
              <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
                <svg width="16" height="16" style={{ animation:"spinIcon .7s linear infinite" }}>
                  <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="2" />
                  <circle cx="8" cy="8" r="6" fill="none" stroke="#fff" strokeWidth="2"
                    strokeDasharray="10 28" strokeLinecap="round" />
                </svg>
                Searching Web &amp; Analysing…
              </span>
            ) : false /* Vercel proxy configured */
              ? "⚠ Set PROXY_URL in veridect.jsx first"
              : "🌐  Check Facts  ·  Ctrl+Enter"}
          </button>
        </div>

        {/* ── History ─────────────────────────────────────────────── */}
        {showH && (
          <div style={{ background:C.bg2, border:`1px solid ${C.line}`, borderRadius:14,
            padding:20, marginBottom:14, maxHeight:280, overflowY:"auto" }}>
            <SL label="Recent Analyses" />
            {history.length === 0
              ? <p style={{ fontSize:12, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>No history yet.</p>
              : history.map((h,i) => {
                  const hc = (VC[h.verdict]||VC.UNVERIFIED).col;
                  return (
                    <div key={h.id} onClick={() => { setInput(h.input); setShowH(false); }}
                      style={{ display:"flex", gap:10, alignItems:"center",
                        padding:"8px 10px", borderRadius:8, cursor:"pointer",
                        background:C.bg2, border:`1px solid ${C.line}`, marginBottom:6,
                        transition:"background .15s" }}
                      onMouseEnter={e=>e.currentTarget.style.background=C.bg3}
                      onMouseLeave={e=>e.currentTarget.style.background=C.bg2}>
                      <Pill label={h.verdict} col={hc} />
                      <span style={{ flex:1, fontSize:11, color:C.sub, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap",
                        fontFamily:"'IBM Plex Mono',monospace" }}>{h.preview}</span>
                      <span style={{ fontSize:9.5, color:C.muted, flexShrink:0,
                        fontFamily:"'IBM Plex Mono',monospace" }}>{h.ts}</span>
                    </div>
                  );
                })}
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────── */}
        {error && (
          <div style={{ padding:"16px 20px", background:`${C.red}0e`,
            border:`1px solid ${C.red}44`, borderRadius:12, marginBottom:14 }}>
            <div style={{ fontSize:13, color:C.red, fontWeight:700, marginBottom:6,
              fontFamily:"'Chakra Petch',sans-serif" }}>✗ Analysis Failed</div>
            <div style={{ fontSize:12, color:C.sub, lineHeight:1.7,
              fontFamily:"'IBM Plex Mono',monospace" }}>{error}</div>
            <div style={{ fontSize:11, color:C.muted, marginTop:8, lineHeight:1.7,
              fontFamily:"'IBM Plex Mono',monospace" }}>
              Tips: Text must be 20+ words. URLs must be public. Try again — web search occasionally times out.
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            RESULTS
        ══════════════════════════════════════════════════════════ */}
        {result && vc && (
          <div className="reveal">

            {/* ── Verdict Hero ──────────────────────────────────── */}
            <div style={{
              background:C.bg1, borderRadius:"0 0 16px 16px",
              border:`1px solid ${vc.col}44`, borderTop:`3px solid ${vc.col}`,
              padding:"28px 28px 22px", marginBottom:14,
              position:"relative", overflow:"hidden",
              boxShadow:`0 0 60px ${vc.col}0e`,
            }}>
              {/* grid texture */}
              <div style={{ position:"absolute", inset:0, pointerEvents:"none", opacity:.25,
                backgroundImage:`linear-gradient(${C.line} 1px,transparent 1px),linear-gradient(90deg,${C.line} 1px,transparent 1px)`,
                backgroundSize:"40px 40px" }} />

              <div style={{ position:"relative", display:"flex", gap:24, flexWrap:"wrap", alignItems:"center" }}>
                <Arc v={result.score || 0} sz={152} />

                <div style={{ flex:1, minWidth:200 }}>
                  {/* verdict label + badges */}
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:12 }}>
                    <span style={{ fontSize:"clamp(20px,4vw,30px)", fontWeight:700,
                      color:vc.col, letterSpacing:1, fontFamily:"'Chakra Petch',sans-serif",
                      textShadow:`0 0 24px ${vc.col}88` }}>
                      {vc.icon} {vc.label}
                    </span>
                    {result.risk    && <Pill label={`RISK: ${result.risk}`}      col={RISK_COL[result.risk]||C.muted} />}
                    {result.category && <Pill label={result.category}            col={C.violet} />}
                    <Pill label={`${result.confidence||0}% confident`}           col={C.blue} />
                    {result.when    && <Pill label={`📅 ${result.when}`}         col={C.amber} />}
                  </div>

                  {result.headline && (
                    <div style={{ fontSize:15, fontWeight:600, color:C.txt, marginBottom:10,
                      fontFamily:"'Chakra Petch',sans-serif", letterSpacing:.5 }}>
                      {result.headline}
                    </div>
                  )}

                  <p style={{ fontSize:12.5, color:C.sub, lineHeight:1.8, marginBottom:12,
                    fontFamily:"'IBM Plex Mono',monospace" }}>{result.summary}</p>

                  {result.score_reason && (
                    <div style={{ padding:"10px 14px", background:`${C.amber}09`,
                      border:`1px solid ${C.amber}22`, borderRadius:8,
                      fontSize:12, color:C.sub, lineHeight:1.7, marginBottom:10,
                      fontFamily:"'IBM Plex Mono',monospace" }}>
                      <strong style={{ color:C.amber }}>📊 Why this score: </strong>{result.score_reason}
                    </div>
                  )}
                  {result.source_credibility && (
                    <div style={{ padding:"10px 14px", background:`${C.violet}09`,
                      border:`1px solid ${C.violet}22`, borderRadius:8,
                      fontSize:12, color:C.sub, lineHeight:1.7, marginBottom:10,
                      fontFamily:"'IBM Plex Mono',monospace" }}>
                      <strong style={{ color:C.violet }}>🏛 Source credibility: </strong>{result.source_credibility}
                    </div>
                  )}
                  {result.evidence && (
                    <div style={{ padding:"10px 14px", background:`${C.cyan}09`,
                      border:`1px solid ${C.cyan}22`, borderRadius:8,
                      fontSize:12, color:C.sub, lineHeight:1.7, marginBottom:10,
                      fontFamily:"'IBM Plex Mono',monospace" }}>
                      <strong style={{ color:C.cyan }}>🌐 Web found: </strong>{result.evidence}
                    </div>
                  )}

                  {result.action && (
                    <div style={{ padding:"9px 14px", background:`${C.cyan}07`,
                      border:`1px solid ${C.cyan}1f`, borderRadius:7,
                      fontSize:12, color:C.cyan, lineHeight:1.6,
                      fontFamily:"'IBM Plex Mono',monospace" }}>
                      ▶ {result.action}
                    </div>
                  )}
                </div>

                {/* mini scores */}
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {[{l:"CRED",v:result.credibility||0,c:C.blue},{l:"MANIP",v:result.manipulation||0,c:C.red}].map(g => (
                    <div key={g.l} style={{ textAlign:"center", padding:"12px 16px",
                      background:C.bg3, borderRadius:10, border:`1px solid ${C.line}` }}>
                      <Num to={g.v} col={g.c} sz={22} ms={1000} />
                      <div style={{ fontSize:8.5, color:C.muted, letterSpacing:1.5,
                        marginTop:4, fontFamily:"'IBM Plex Mono',monospace" }}>{g.l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* searched queries */}
              {(result.searched||[]).length > 0 && (
                <div style={{ position:"relative", marginTop:18,
                  display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
                  <span style={{ fontSize:9, color:C.muted, letterSpacing:2,
                    fontFamily:"'IBM Plex Mono',monospace" }}>SEARCHED:</span>
                  {(result.searched||[]).map((q,i) => (
                    <span key={i} style={{ fontSize:9.5, color:C.cyan, padding:"2px 9px",
                      background:`${C.cyan}0d`, border:`1px solid ${C.cyan}22`,
                      borderRadius:3, fontFamily:"'IBM Plex Mono',monospace" }}>🔍 {q}</span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Tabs ──────────────────────────────────────────── */}
            <div style={{ display:"flex", gap:2, marginBottom:14,
              background:C.bg1, padding:5, borderRadius:10,
              border:`1px solid ${C.line}`, overflowX:"auto" }}>
              {TABS.map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex:1, minWidth:80, padding:"8px 10px", border:"none", borderRadius:7,
                  background: tab===t?`${C.cyan}15`:"transparent",
                  color: tab===t?C.cyan:C.muted,
                  fontSize:10.5, letterSpacing:.5, textTransform:"uppercase",
                  cursor:"pointer", transition:"all .15s", whiteSpace:"nowrap",
                  borderBottom: tab===t?`2px solid ${C.cyan}`:"2px solid transparent",
                  fontFamily:"'IBM Plex Mono',monospace",
                }}>{t}</button>
              ))}
            </div>

            {/* ── Overview ──────────────────────────────────────── */}
            {tab==="Overview" && (
              <div className="g2">
                <Card>
                  <SL label="Dimension Scores" />
                  {Object.entries(result.dims||{}).map(([k,v],i) => (
                    <Bar key={k} label={k} val={v}
                      col={v>=70?C.green:v>=40?C.amber:C.red}
                      icon={["🎯","🏛","🔗","🌐","📝"][i]||"·"} delay={i*90} />
                  ))}
                </Card>
                <Card style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <SL label="Radar Analysis" />
                  <Spider dims={result.dims} />
                </Card>
                <Card>
                  <SL label="Positive Signals" col={C.green} />
                  {(result.signals||[]).length
                    ? (result.signals||[]).map((s,i) => (
                        <div key={i} style={{ display:"flex", gap:8, marginBottom:8, fontSize:12.5,
                          color:C.sub, lineHeight:1.65, fontFamily:"'IBM Plex Mono',monospace" }}>
                          <span style={{ color:C.green, flexShrink:0 }}>›</span>{s}
                        </div>
                      ))
                    : <p style={{ fontSize:12, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>None detected.</p>}
                </Card>
                <Card>
                  <SL label="Red Flags" col={C.red} />
                  {(result.flags||[]).length
                    ? (result.flags||[]).map((f,i) => (
                        <div key={i} style={{ display:"flex", gap:8, marginBottom:8, fontSize:12.5,
                          color:C.sub, lineHeight:1.65, fontFamily:"'IBM Plex Mono',monospace" }}>
                          <span style={{ color:C.red, flexShrink:0 }}>✗</span>{f}
                        </div>
                      ))
                    : <p style={{ fontSize:12, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>None detected.</p>}
                </Card>
                <Card style={{ gridColumn:"1 / -1" }}>
                  <SL label="Key Findings" />
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",
                    gap:10, marginBottom:18 }}>
                    {(result.findings||[]).map((f,i) => (
                      <div key={i} style={{ padding:"10px 13px", background:C.bg3,
                        border:`1px solid ${C.line}`, borderLeft:`3px solid ${C.cyan}`,
                        borderRadius:"0 8px 8px 0", fontSize:12.5, color:C.sub,
                        lineHeight:1.65, display:"flex", gap:8,
                        fontFamily:"'IBM Plex Mono',monospace" }}>
                        <span style={{ color:C.cyan, fontWeight:700, flexShrink:0,
                          fontFamily:"'Chakra Petch',sans-serif" }}>
                          {String(i+1).padStart(2,"0")}
                        </span>{f}
                      </div>
                    ))}
                  </div>
                  <SL label="Verify With — Click to Open" col={C.blue} />
                  <VerifyLinks result={result} />
                </Card>
              </div>
            )}

            {/* ── Claims ────────────────────────────────────────── */}
            {tab==="Claims" && (
              <Card>
                <SL label={`Claim Verification — ${(result.claims||[]).length} claims · click to expand`} />
                {(result.claims||[]).length === 0
                  ? <p style={{ fontSize:13, color:C.muted, textAlign:"center", padding:"30px 0",
                      fontFamily:"'IBM Plex Mono',monospace" }}>No individual claims extracted.</p>
                  : (result.claims||[]).map((c,i) => <ClaimRow key={i} c={c} />)}
              </Card>
            )}

            {/* ── Bias & Mood ───────────────────────────────────── */}
            {tab==="Bias & Mood" && (
              <div className="g2">
                <Card>
                  <SL label="Political Bias Spectrum" />
                  {result.bias
                    ? <>
                        <BiasBar score={result.bias.score} dir={result.bias.dir} />
                        {result.bias.note && (
                          <p style={{ marginTop:14, fontSize:12.5, color:C.sub, lineHeight:1.75,
                            fontFamily:"'IBM Plex Mono',monospace" }}>{result.bias.note}</p>
                        )}
                      </>
                    : <p style={{ fontSize:12, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>Not available.</p>}
                </Card>
                <Card>
                  <SL label="Sentiment & Emotion" />
                  {result.mood && (
                    <>
                      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
                        {[{l:"Overall",v:result.mood.tone,c:C.blue},{l:"Emotion",v:result.mood.emotion,c:C.amber}].map(s => (
                          <div key={s.l} style={{ flex:1, textAlign:"center", padding:"14px 8px",
                            background:C.bg3, border:`1px solid ${C.line}`, borderRadius:10 }}>
                            <div style={{ fontSize:28, marginBottom:8 }}>
                              {({Positive:"😊",Negative:"😠",Mixed:"😐",Neutral:"😶",
                                Fear:"😨",Anger:"😡",Hope:"🌟",Disgust:"🤢",Excitement:"🤩"})[s.v]||"🔍"}
                            </div>
                            <div style={{ fontSize:12, fontWeight:700, color:s.c, fontFamily:"'Chakra Petch',sans-serif" }}>{s.v}</div>
                            <div style={{ fontSize:9, color:C.muted, letterSpacing:1.5, marginTop:3,
                              textTransform:"uppercase", fontFamily:"'IBM Plex Mono',monospace" }}>{s.l}</div>
                          </div>
                        ))}
                      </div>
                      {(result.mood.tactics||[]).length > 0 && (
                        <>
                          <SL label="Manipulation Tactics" col={C.red} />
                          {result.mood.tactics.map((t,i) => (
                            <div key={i} style={{ display:"flex", gap:8, marginBottom:7, fontSize:12.5,
                              color:C.sub, lineHeight:1.6, fontFamily:"'IBM Plex Mono',monospace" }}>
                              <span style={{ color:C.red }}>›</span>{t}
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </Card>
              </div>
            )}

            {/* ── Language ──────────────────────────────────────── */}
            {tab==="Language" && (
              <div className="g2">
                <Card>
                  <SL label="Language Metrics" />
                  {result.lang ? (
                    <>
                      <Bar label="Clickbait Score"   val={result.lang.clickbait||0}   col={C.red}    icon="🎣" delay={0} />
                      <Bar label="Sensationalism"     val={result.lang.sensational||0} col={C.amber}  icon="📢" delay={100} />
                      <Bar label="Emotional Loading"  val={result.lang.emotional||0}   col={C.violet} icon="🧠" delay={200} />
                      <Bar label="Text Complexity"    val={result.lang.complex||0}     col={C.blue}   icon="🎓" delay={300} />
                    </>
                  ) : <p style={{ fontSize:12, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>Not available.</p>}
                </Card>
                <Card>
                  <SL label="Power Words" col={C.amber} />
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:20 }}>
                    {(result.lang?.hot||[]).length
                      ? result.lang.hot.map((w,i) => <Pill key={i} label={w} col={C.amber} />)
                      : <span style={{ fontSize:12, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>None detected</span>}
                  </div>
                  <SL label="Hedge / Qualifier Words" col={C.blue} />
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {(result.lang?.hedge||[]).length
                      ? result.lang.hedge.map((w,i) => <Pill key={i} label={w} col={C.blue} />)
                      : <span style={{ fontSize:12, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>None detected</span>}
                  </div>
                </Card>
              </div>
            )}

            {/* ── Raw Data ──────────────────────────────────────── */}
            {tab==="Raw Data" && (
              <div className="g2">
                <Card>
                  <SL label="Score Matrix" />
                  {[{l:"Truth Score",v:result.score||0,c:C.green},{l:"Credibility",v:result.credibility||0,c:C.blue},
                    {l:"Confidence",v:result.confidence||0,c:C.amber},{l:"Manipulation",v:result.manipulation||0,c:C.red}]
                    .map((s,i) => (
                      <div key={s.l} style={{ display:"flex", justifyContent:"space-between",
                        alignItems:"center", padding:"9px 0", borderBottom:`1px solid ${C.line}` }}>
                        <span style={{ fontSize:12, color:C.sub, fontFamily:"'IBM Plex Mono',monospace" }}>{s.l}</span>
                        <Num to={s.v} col={s.c} sz={16} ms={700+i*150} />
                      </div>
                    ))}
                </Card>
                <Card>
                  <SL label="Metadata" />
                  {[{l:"Verdict",v:result.verdict},{l:"Category",v:result.category},{l:"Risk",v:result.risk},
                    {l:"Timeline",v:result.when||"N/A"},{l:"Bias",v:result.bias?.dir||"N/A"},
                    {l:"Emotion",v:result.mood?.emotion||"N/A"},{l:"Checked",v:new Date().toLocaleString()}]
                    .map(m => (
                      <div key={m.l} style={{ display:"flex", justifyContent:"space-between",
                        padding:"8px 0", borderBottom:`1px solid ${C.line}`, fontSize:12 }}>
                        <span style={{ color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>{m.l}</span>
                        <span style={{ color:C.txt, fontWeight:600, fontFamily:"'Chakra Petch',sans-serif" }}>{m.v}</span>
                      </div>
                    ))}
                </Card>
                <Card style={{ gridColumn:"1 / -1" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <SL label="Raw JSON Report" />
                    <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(result,null,2))}
                      style={{ padding:"5px 14px", borderRadius:6, background:C.bg3,
                        border:`1px solid ${C.line}`, color:C.muted, fontSize:11,
                        cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace" }}>Copy JSON</button>
                  </div>
                  <pre style={{ fontSize:10.5, color:C.sub, lineHeight:1.65, background:C.bg3,
                    padding:14, borderRadius:8, border:`1px solid ${C.line}`,
                    maxHeight:420, overflowY:"auto", overflowX:"auto",
                    fontFamily:"'IBM Plex Mono',monospace" }}>
                    {JSON.stringify(result,null,2)}
                  </pre>
                </Card>
              </div>
            )}

          </div>
        )}

        {/* ── Export bar (shown when result is ready) ─────────────── */}
        {result && (
          <div style={{ margin:"24px 0 0", padding:"14px 20px",
            background:C.bg2, border:`1px solid ${C.line}`, borderRadius:12,
            display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, color:C.muted, fontFamily:"'IBM Plex Mono',monospace",
              flex:1 }}>📋 Export your analysis:</span>
            <button onClick={() => {
                const vc2 = VC[result.verdict]||VC.UNVERIFIED;
                const txt = [
                  "═══════════════════════════════════════",
                  "  VERIDECT — AI FACT-CHECK REPORT",
                  "═══════════════════════════════════════",
                  `Verdict   : ${vc2.label}`,
                  `Score     : ${result.score}/100`,
                  `Confidence: ${result.confidence}%`,
                  `Category  : ${result.category}`,
                  `Risk      : ${result.risk}`,
                  `Timeline  : ${result.when||"N/A"}`,
                  "",
                  "HEADLINE:",
                  result.headline,
                  "",
                  "SUMMARY:",
                  result.summary,
                  "",
                  "WHY THIS SCORE:",
                  result.score_reason||"N/A",
                  "",
                  "SOURCE CREDIBILITY:",
                  result.source_credibility||"N/A",
                  "",
                  "WEB EVIDENCE:",
                  result.evidence||"N/A",
                  "",
                  "KEY FINDINGS:",
                  ...(result.findings||[]).map((f,i)=>`  ${i+1}. ${f}`),
                  "",
                  "RED FLAGS:",
                  ...(result.flags||[]).map(f=>`  ✗ ${f}`),
                  "",
                  "CLAIMS VERIFIED:",
                  ...(result.claims||[]).map(c=>`  [${c.verdict}] ${c.text}`),
                  "",
                  "BIAS: " + (result.bias?.dir||"N/A"),
                  "SEARCHES: " + (result.searched||[]).join(", "),
                  "",
                  `Generated: ${new Date().toLocaleString()}`,
                  "Tool: VERIDECT v5 — AI Fact Intelligence",
                  "═══════════════════════════════════════",
                ].join("\n");
                navigator.clipboard?.writeText(txt);
                alert("Report copied to clipboard! Paste it anywhere.");
              }} style={{ padding:"8px 18px", borderRadius:8, cursor:"pointer",
                border:`1px solid ${C.cyan}44`, background:`${C.cyan}10`,
                color:C.cyan, fontSize:11.5, fontWeight:600,
                fontFamily:"'Chakra Petch',sans-serif", transition:"all .2s" }}
              onMouseEnter={e=>{e.currentTarget.style.background=`${C.cyan}22`;}}
              onMouseLeave={e=>{e.currentTarget.style.background=`${C.cyan}10`;}}>
              📋 Copy Report
            </button>
            <button onClick={() => window.print()} style={{ padding:"8px 18px", borderRadius:8, cursor:"pointer",
                border:`1px solid ${C.blue}44`, background:`${C.blue}10`,
                color:C.blue, fontSize:11.5, fontWeight:600,
                fontFamily:"'Chakra Petch',sans-serif", transition:"all .2s" }}
              onMouseEnter={e=>{e.currentTarget.style.background=`${C.blue}22`;}}
              onMouseLeave={e=>{e.currentTarget.style.background=`${C.blue}10`;}}>
              🖨️ Print / Save PDF
            </button>
            <button onClick={() => {
                const data = { tool:"VERIDECT v5", timestamp:new Date().toISOString(), input:input.slice(0,200), result };
                const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
                const a = document.createElement("a"); a.href=URL.createObjectURL(blob);
                a.download=`veridect-report-${Date.now()}.json`; a.click();
              }} style={{ padding:"8px 18px", borderRadius:8, cursor:"pointer",
                border:`1px solid ${C.violet}44`, background:`${C.violet}10`,
                color:C.violet, fontSize:11.5, fontWeight:600,
                fontFamily:"'Chakra Petch',sans-serif", transition:"all .2s" }}
              onMouseEnter={e=>{e.currentTarget.style.background=`${C.violet}22`;}}
              onMouseLeave={e=>{e.currentTarget.style.background=`${C.violet}10`;}}>
              ⬇️ Download JSON
            </button>
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────── */}
        <footer style={{ marginTop:24, paddingTop:18, borderTop:`1px solid ${C.line}`,
          display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <span style={{ fontSize:9.5, color:C.muted, letterSpacing:2, fontFamily:"'IBM Plex Mono',monospace" }}>
            VERIDECT v5 · CLAUDE SONNET · LIVE WEB SEARCH · {new Date().getFullYear()}
          </span>
          <span style={{ fontSize:9.5, color:C.muted, fontFamily:"'IBM Plex Mono',monospace" }}>
            Always cross-verify with trusted sources
          </span>
        </footer>

      </div>
    </div>
  );
}