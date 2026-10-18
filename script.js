
const videoInput = document.getElementById("videoInput");
const dropzone = document.getElementById("dropzone");
const sourceVideo = document.getElementById("sourceVideo");
const fileInfo = document.getElementById("fileInfo");
const generateBtn = document.getElementById("generateBtn");
const progressArea = document.getElementById("progressArea");
const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const progressDetail = document.getElementById("progressDetail");
const resultsSection = document.getElementById("resultsSection");
const results = document.getElementById("results");
const resultsSummary = document.getElementById("resultsSummary");
const notice = document.getElementById("notice");
const subsToggle = document.getElementById("subsToggle");
const subsModel = document.getElementById("subsModel");

let selectedFile = null;
let videoDuration = 0;
let videoUrl = null;
let ffmpeg = null;
let fetchFile = null;
let toBlobURL = null;
let ffmpegReady = false;
let transcriber = null;
let transcriberModel = null;
let fontReady = false;

// Fuente necesaria para incrustar subtítulos (soporta ñ, á, ¿, ¡…)
const FONT_URL = "https://raw.githubusercontent.com/ffmpegwasm/testdata/master/arial.ttf";

function formatTime(seconds){
  seconds = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function formatSize(bytes){
  if(bytes < 1024*1024) return `${(bytes/1024).toFixed(0)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}
function showNotice(message,type=""){
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.classList.remove("hidden");
}
function setProgress(percent,text,detail=""){
  progressArea.classList.remove("hidden");
  progressBar.style.width = `${Math.max(0,Math.min(100,percent))}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressText.textContent = text;
  progressDetail.textContent = detail;
}
function clearNotice(){notice.className="notice hidden";notice.textContent=""}

function setVideoFile(file){
  clearNotice();
  if(!file) return;

  const allowed = ["video/mp4","video/quicktime","video/webm","video/x-matroska","video/mpeg"];
  const looksVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|mpeg|mpg)$/i.test(file.name);
  if(!looksVideo || (!allowed.includes(file.type) && !/\.(mp4|mov|webm|mkv|mpeg|mpg)$/i.test(file.name))){
    showNotice("Ese archivo no parece ser un vídeo compatible. Prueba con un MP4 (H.264) si es posible.","error");
    return;
  }

  selectedFile = file;
  videoDuration = 0;
  generateBtn.disabled = true;
  resultsSection.classList.add("hidden");
  results.innerHTML = "";

  if(videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  sourceVideo.onloadedmetadata = () => {
    const duration = Number(sourceVideo.duration);
    if (Number.isFinite(duration) && duration > 0) {
      videoDuration = duration;
      fileInfo.innerHTML = `<b>${escapeHtml(file.name)}</b><span>${formatSize(file.size)} · ${formatTime(videoDuration)}</span>`;
      generateBtn.disabled = false;
    } else {
      showNotice("No se ha podido leer la duración del vídeo. Prueba con otro MP4.","error");
      generateBtn.disabled = true;
    }
  };

  sourceVideo.oncanplay = () => {
    const duration = Number(sourceVideo.duration);
    if (!videoDuration && Number.isFinite(duration) && duration > 0) {
      videoDuration = duration;
      fileInfo.innerHTML = `<b>${escapeHtml(file.name)}</b><span>${formatSize(file.size)} · ${formatTime(videoDuration)}</span>`;
      generateBtn.disabled = false;
    }
  };

  sourceVideo.src = videoUrl;
  sourceVideo.load();
  sourceVideo.classList.remove("hidden");

  fileInfo.innerHTML = `<b>${escapeHtml(file.name)}</b><span>${formatSize(file.size)} · leyendo duración…</span>`;
  fileInfo.classList.remove("hidden");
  sourceVideo.onerror = () => {
    showNotice("El navegador no puede reproducir este archivo. Para evitar el problema de MP4, utiliza un MP4 H.264/AAC.","error");
    generateBtn.disabled = true;
  };
}

videoInput.addEventListener("change", e => setVideoFile(e.target.files[0]));
dropzone.addEventListener("dragover", e => {e.preventDefault();dropzone.classList.add("dragover")});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();dropzone.classList.remove("dragover");
  setVideoFile(e.dataTransfer.files[0]);
});

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

/*
  Este selector crea varios fragmentos repartidos por el vídeo.
  No pretende decidir semánticamente cuál es "el mejor momento":
  esa detección inteligente requeriría un modelo de IA/backend.
*/
const CLIP_COUNT = 20; // número de clips a generar

function buildSegments(duration){
  const count = CLIP_COUNT;
  // Duración de cada clip: reparte el vídeo en 20 trozos (con un pequeño solape)
  let length = Math.min(45, Math.max(6, (duration / count) * 1.3));
  length = Math.min(length, Math.max(4, duration - 1));

  const usable = Math.max(0, duration - length);
  const segments = [];
  for(let i=0;i<count;i++){
    const ratio = count === 1 ? .5 : i/(count-1);
    const start = usable * ratio;
    const end = Math.min(duration, start + length);
    if(end-start >= 3) segments.push({start,end});
  }
  return segments;
}


function getInputExtension(file){
  const name = (file?.name || "").toLowerCase();
  const match = name.match(/\.(mp4|mov|webm|mkv|mpeg|mpg|m4v)$/);
  if(match) return match[1];
  if(file?.type === "video/webm") return "webm";
  if(file?.type === "video/quicktime") return "mov";
  return "mp4";
}

function addFfmpegLog(message){
  const log = document.getElementById("ffmpegLog");
  if(!log) return;
  log.classList.remove("hidden");
  log.textContent = (log.textContent + message + "\n").slice(-6000);
}

async function loadFFmpeg(){
  if(ffmpegReady) return;
  setProgress(3,"Preparando el motor de vídeo…","Descargando el motor MP4. Solo ocurre la primera vez.");

  const ffmpegModule = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
  const utilModule = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js");

  ffmpeg = new ffmpegModule.FFmpeg();
  fetchFile = utilModule.fetchFile;
  toBlobURL = utilModule.toBlobURL;

  ffmpeg.on("log", ({message}) => {
    console.log("[ClipFinder FFmpeg]", message);
    if(/error|invalid|failed|unable|unknown/i.test(message)) addFfmpegLog(message);
  });

  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  const localWorkerURL = new URL("./ffmpeg-worker.js", document.baseURI).href;

  await ffmpeg.load({
    // The main FFmpeg worker MUST be same-origin on GitHub Pages.
    // The worker itself imports the official CDN worker as an ES module.
    classWorkerURL: localWorkerURL,
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm", true, ({received,total})=>{
      if(total){
        setProgress(1 + (received/total)*2, "Descargando el motor de vídeo…",
          `${(received/1048576).toFixed(0)} de ${(total/1048576).toFixed(0)} MB · solo la primera vez`);
      }
    })
  });
  ffmpegReady = true;
}

async function writeInput(){
  const extension = getInputExtension(selectedFile);
  const inputName = `input.${extension}`;
  await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));
  return inputName;
}

// ---------- SUBTÍTULOS ----------
subsToggle.addEventListener("change",()=>{
  subsModel.closest(".options").classList.toggle("subs-off",!subsToggle.checked);
});

async function loadTranscriber(){
  if(transcriber && transcriberModel === subsModel.value) return;
  const modelId = subsModel.value;
  setProgress(3,"Cargando el modelo de voz…","Conectando con el servidor del modelo…");

  const tf = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2");
  tf.env.allowLocalModels = false;

  const files = {};
  let lastUi = 0;
  transcriber = await tf.pipeline("automatic-speech-recognition", modelId, {
    device: "wasm",
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: (p) => {
      if(p.status === "progress" && p.total){
        files[p.file] = {loaded:p.loaded, total:p.total};
        const now = performance.now();
        if(now - lastUi < 150) return;
        lastUi = now;
        let loaded = 0, total = 0;
        for(const f of Object.values(files)){ loaded += f.loaded; total += f.total; }
        setProgress(3 + (loaded/total)*7, "Descargando el modelo de voz…",
          `${(loaded/1048576).toFixed(0)} de ${(total/1048576).toFixed(0)} MB · solo la primera vez, luego queda en caché`);
      }else if(p.status === "ready"){
        setProgress(10,"Modelo de voz listo","Empezando…");
      }
    }
  });
  transcriberModel = modelId;
}

async function ensureFont(){
  if(fontReady) return;
  try{ await ffmpeg.createDir("/fonts"); }catch(_){}
  await ffmpeg.writeFile("/fonts/arial.ttf", await fetchFile(FONT_URL));
  fontReady = true;
}

function srtTime(t){
  t = Math.max(0,t);
  const ms = Math.min(999, Math.round((t - Math.floor(t))*1000));
  const total = Math.floor(t);
  const p = (n,l=2)=>String(n).padStart(l,"0");
  return `${p(Math.floor(total/3600))}:${p(Math.floor(total%3600/60))}:${p(total%60)},${p(ms,3)}`;
}

function wrapLines(text,max=32){
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for(const w of words){
    if((line+" "+w).trim().length > max && line){ lines.push(line); line = w; }
    else line = (line+" "+w).trim();
  }
  if(line) lines.push(line);
  return lines.join("\n");
}

function buildSrt(cues){
  return cues.map((c,i)=>`${i+1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${wrapLines(c.text)}\n`).join("\n");
}

async function transcribeClip(inputName,start,duration,index){
  // Audio del clip a 16 kHz mono (float32) para Whisper
  const rawName = `audio_${index}.raw`;
  const code = await ffmpeg.exec([
    "-ss", String(start), "-i", inputName, "-t", String(duration),
    "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-y", rawName
  ]);
  if(code !== 0) throw new Error("No se pudo extraer el audio del clip.");
  const data = await ffmpeg.readFile(rawName);
  await ffmpeg.deleteFile(rawName);
  const audio = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));

  const out = await transcriber(audio,{
    language: "spanish",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true
  });

  let cues = (out.chunks || [])
    .map(c => ({
      start: c.timestamp?.[0] ?? 0,
      end: c.timestamp?.[1] ?? duration,
      text: String(c.text || "").trim()
    }))
    // Whisper a veces "alucina" estos créditos en tramos instrumentales
    .filter(c => c.text && !/amara\.org|subt[ií]tulos (por|realizados)|♪/i.test(c.text));

  cues = cues.map((c,i)=>{
    let end = Math.min(c.end, duration);
    if(end <= c.start) end = Math.min(duration, c.start + 2);
    const next = cues[i+1];
    if(next && end > next.start) end = Math.max(c.start + .3, next.start);
    return {...c, end};
  });
  return cues;
}

// ---------- EXPORTAR ----------
async function exportOneClip(inputName,start,end,index,total,srtName=null){
  const outputName = `clip_${String(index).padStart(2,"0")}.mp4`;
  const duration = Math.max(1,end-start);

  const args = ["-ss", String(start), "-i", inputName, "-t", String(duration)];
  if(srtName){
    args.push("-vf",
      `subtitles=${srtName}:fontsdir=/fonts:force_style='FontName=Arial,FontSize=18,Outline=2,Shadow=0,MarginV=28'`);
  }
  args.push(
    "-map", "0:v:0", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart", "-y", outputName
  );

  const code = await ffmpeg.exec(args);
  if(code !== 0) throw new Error("FFmpeg devolvió el código " + code);

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data.buffer],{type:"video/mp4"});
  await ffmpeg.deleteFile(outputName);
  return URL.createObjectURL(blob);
}

async function generateClips(){
  if(!selectedFile || !videoDuration) return;

  generateBtn.disabled = true;
  results.innerHTML = "";
  resultsSection.classList.add("hidden");
  clearNotice();

  const log = document.getElementById("ffmpegLog");
  if(log){ log.textContent=""; log.classList.add("hidden"); }

  const withSubs = subsToggle.checked;
  let subsFailed = 0;

  try{
    const segments = buildSegments(videoDuration);
    if(!segments.length) throw new Error("No se pudieron crear fragmentos.");

    await loadFFmpeg();
    if(withSubs){
      await loadTranscriber();
      try{ await ensureFont(); }
      catch(e){ console.warn("No se pudo cargar la fuente:", e); }
    }
    const inputName = await writeInput();

    resultsSection.classList.remove("hidden");
    resultsSummary.textContent = `Generando ${segments.length} clips MP4 automáticamente…`;

    const total = segments.length;
    for(let i=0;i<total;i++){
      const index = i+1;
      const {start,end} = segments[i];
      const dur = Math.max(1,end-start);
      const base = 11 + (i/total)*85;
      const share = 85/total;

      let cues = [];
      let srtText = "";
      let srtName = null;

      if(withSubs){
        setProgress(base, `Transcribiendo clip ${index} de ${total}…`,
          `${formatTime(start)} → ${formatTime(end)} · escuchando la letra (puede tardar)`);
        try{
          cues = await transcribeClip(inputName,start,dur,index);
          if(cues.length){
            srtText = buildSrt(cues);
            srtName = `sub_${String(index).padStart(2,"0")}.srt`;
            await ffmpeg.writeFile(srtName, srtText);
          }
        }catch(e){
          console.error(e);
          subsFailed++;
        }
      }

      setProgress(base + share*0.5, `Generando clip ${index} de ${total}…`,
        `${formatTime(start)} → ${formatTime(end)} · ${srtName ? "incrustando subtítulos y " : ""}convirtiendo a MP4`);

      let url;
      let burned = !!srtName;
      try{
        url = await exportOneClip(inputName,start,end,index,total,srtName);
      }catch(e){
        if(!srtName) throw e;
        // Si falla la incrustación, exportamos el clip sin subtítulos (el .srt sigue disponible)
        console.warn("Fallo al incrustar subtítulos, se exporta sin ellos:", e);
        burned = false;
        subsFailed++;
        url = await exportOneClip(inputName,start,end,index,total,null);
      }
      if(srtName){ try{ await ffmpeg.deleteFile(srtName); }catch(_){} }

      const srtUrl = srtText
        ? URL.createObjectURL(new Blob(["\ufeff"+srtText],{type:"text/plain;charset=utf-8"}))
        : null;

      addClipCard(index,segments[i],url,{srtUrl,cues,burned,withSubs});
      resultsSummary.textContent = `${index} de ${total} clips listos.`;
    }

    try{ await ffmpeg.deleteFile(inputName); }catch(_){}

    setProgress(100,"Proceso terminado","Todos los clips están listos para descargar.");
    resultsSummary.textContent = `${total} clips MP4 listos.`;

    if(withSubs && subsFailed){
      showNotice("Clips generados, pero en algunos no se pudieron crear o incrustar los subtítulos (música muy fuerte o sin voz clara). Revisa cada clip.","error");
    }else{
      showNotice(withSubs
        ? "Listo. Los clips llevan subtítulos incrustados. Whisper puede equivocarse con voces cantadas: revisa la letra y, si hace falta, corrige el .srt."
        : "Listo. Los clips se han generado como MP4 independientes.","ok");
    }
  }catch(error){
    console.error(error);
    const detail = error?.message ? ` Detalle: ${error.message}` : "";
    showNotice("Ha fallado el proceso."+detail,"error");
    setProgress(0,"Error al generar los clips","El detalle técnico aparece debajo si FFmpeg ha devuelto información.");
  }finally{
    generateBtn.disabled = false;
  }
}

function addClipCard(index,segment,url,subs={}){
  const {srtUrl=null,cues=[],burned=false,withSubs=false} = subs;
  const num = String(index).padStart(2,"0");
  const card = document.createElement("article");
  card.className = "clip-card";

  const lyrics = cues.length ? cues.map(c=>c.text).join("\n") : "";
  const tag = !withSubs ? "MP4" : burned ? "MP4 · subtitulado" : "MP4 · sin subtítulos";

  card.innerHTML = `
    <div class="clip-number">CLIP ${num}</div>
    <h3>Fragmento ${index}</h3>
    <div class="clip-meta">${formatTime(segment.start)} — ${formatTime(segment.end)} · ${tag}</div>
    ${lyrics ? `<p class="clip-lyrics">${escapeHtml(lyrics)}</p>` : (withSubs ? `<p class="clip-lyrics">No se detectó letra en este fragmento.</p>` : "")}
    <div class="clip-actions wrap">
      <button class="button button-secondary preview">Previsualizar</button>
      <a class="button button-primary download" download="clip-${num}.mp4">Descargar MP4</a>
      ${srtUrl ? `<a class="button button-secondary button-link srt" download="clip-${num}.srt">Descargar subtítulos (.srt)</a>` : ""}
    </div>
  `;
  card.querySelector(".preview").addEventListener("click",()=>{
    sourceVideo.src = url;
    sourceVideo.currentTime = 0;
    sourceVideo.classList.remove("hidden");
    sourceVideo.play().catch(()=>{});
  });
  card.querySelector(".download").href = url;
  if(srtUrl) card.querySelector(".srt").href = srtUrl;
  results.appendChild(card);
}

generateBtn.addEventListener("click",generateClips);
