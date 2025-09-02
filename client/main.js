const os = require('os');
const {shell} = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { console } = require('inspector');

const searchText = document.getElementById('search');
const searchInfo = document.getElementById('searchInfo');

/**
 * @typedef file
 * @property {string} name 
 * @property {string} parentPath 
 * @property {string} path 
 */
/**
 * @type {file[]}
 */
let files = [];

const APPDATA = getAppData();
const APPNAME = 'FileManager'

const savePath = path.join(APPDATA, APPNAME);

if (!dirExists(savePath)){
  fs.mkdir(savePath);
}

const G_flags = {
  updateSearch: false
};

async function tryToLoadFiles(){
  try {
    let data = await fs.readFile(path.join(savePath, 'saved_data.json'));
    files = JSON.parse(data);
  } catch (error) {
    console.error(error)
  }
}
let G_lastSearchTime = 0;
let G_currentSearchResults = [];
let G_lastSearch = "";
function clamp(val, min, max){
  return Math.max(min, Math.min(val, max));
}
/**
 * 
 * @param {string} search 
 * @returns 
 */
function searchFiles(search = ""){
  search = search.toLowerCase();
  G_lastSearchTime = Date.now();
  G_lastSearch = search;
  const startTime = performance.now();
  let list = [];
  let mode = 0;
  if (search == '*'){ 
    G_currentSearchResults = files;
    renderSearch();
    return;
  };
  if (search.substring(0, 2) == '*.' || search[0] == '.') mode = 1;
  console.log(mode);
  for (let i = 0; i < files.length; i++){
    let f = files[i];
    if (mode == 0){
      let score = 0;
      let name = f.name.toLowerCase();
      if (name.includes(search)) score += 1;
      let lengthDiff = Math.abs(search.length - f.name.length);
      score += 1 - clamp(lengthDiff / 100, 0, 1);
      if (score > 1){
        let searchIndex = name.indexOf(search);
        let changedName = f.name.substring(0, searchIndex) + '<b class="foundPart">' + f.name.substring(searchIndex, searchIndex + search.length) + '</b>' + f.name.substring(searchIndex + search.length, f.name.length);
        f.changedName = changedName;

        list.push({file: f, score: score});
      }
    }
    if (mode == 1){
      let end = search.substring(search.indexOf('.'), search.length);
      if (f.name.endsWith(end)){
        list.push({file: f, score: 0});
      }
    }
    // if (list.length > 100) break;
  }
  const searchTime = performance.now() - startTime;

  searchInfo.innerHTML = `Found ${list.length} results in ` + (Math.floor(searchTime) / 1000).toFixed(2) + ' sec';

  G_currentSearchResults = list.sort((a, b) => b.score - a.score);
  renderSearch();
}

async function dirExists(path) {
  try {
    const stats = await fs.stat(path);
    return stats.isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
function getAppData(){
  let appData;

  switch (os.platform()) {
    case 'win32':
      appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      break;
    case 'darwin':
      appData = path.join(os.homedir(), 'Library', 'Application Support');
      break;
    case 'linux':
      appData = path.join(os.homedir(), '.config');
      break;
    default:
      throw new Error('Unsupported OS');
  }
  return appData;
}

async function findAllFiles(dir) {
  console.time('find files');
  files = [];
  let currentLength = 0;
  const concurrency = 10; 
  const active = new Set(); // track currently running tasks

  // limiter(fn) will:
  //  - if active.size < concurrency, immediately start fn()
  //  - otherwise wait until any active task finishes (Promise.race), then start fn()
  // It returns the Promise that represents fn().

  async function checkDir(currentDir) {
    if (currentDir.includes('C:\\Windows')) {
        return
    };

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      // probably permission denied or some other I/O error—just skip
      return;
    }

    currentLength += entries.length;
    if (currentLength % 100 === 0) {
      console.log(`Processed ${currentLength} entries…`);
    }


    for (const entry of entries) {
        files.push(entry);
        if (entry.isDirectory()) {
            const subdir = path.join(currentDir, entry.name);
            // schedule checkDir(subdir) under our concurrency limiter
            await checkDir(subdir);
        }
    }
  }

  await checkDir(dir)


  console.timeEnd('find files');
  console.log(`Total entries visited: ${currentLength}`);

  // await fs.writeFile(path.join(savePath, 'saved_data.json'), JSON.stringify(files));
}
let multiFiles = [];

async function findAllFilesmulti(dir = 'C:/') {
  console.time('find files multi');
  files = [];
  let currentLength = 0;
  let done = 0;
  const concurrency = 10; 
  const active = new Set(); // track currently running tasks

  G_threadpool.loadWorkers(1, 'readFile.js');

  // limiter(fn) will:
  //  - if active.size < concurrency, immediately start fn()
  //  - otherwise wait until any active task finishes (Promise.race), then start fn()
  // It returns the Promise that represents fn().

  async function checkDir(currentDir) {
    if (currentDir.includes('C:\\Windows')) {
        return
    };

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      // probably permission denied or some other I/O error—just skip
      return;
    }

    currentLength += entries.length;
    if (currentLength % 100 === 0) {
      console.log(`Processed ${currentLength} entries…`);
    }

    let dirLength = 0;
    for (const entry of entries) {
        if (entry.isDirectory()) {
          dirLength++;
        }    
    }

    for (const entry of entries) {
        files.push(entry);
        if (entry.isDirectory()) {
            const subdir = path.join(currentDir, entry.name);
            // schedule checkDir(subdir) under our concurrency limiter
            // await checkDir(subdir);
            
            const worker = G_threadpool.getFreeWorker();
            worker.worker.postMessage(subdir);  

            worker.worker.onmessage = async (e) => {
              if (!e.data.path){
                done++;
              }else{
                console.log('here');
                await checkDir(e.data.path);
                dirLength++;
              }
              if (done >= dirLength){
                console.timeEnd('find files multi');
              }
              files = e.data;
              // searchFiles(G_lastSearch)
            }
        }
    }
  }

  await checkDir(dir)


  console.log(`Total entries visited: ${currentLength}`);

  // await fs.writeFile(path.join(savePath, 'saved_data.json'), JSON.stringify(files));
}
async function renderSearch(){
  // console.log(G_currentSearchResults);

  const itemCount = G_currentSearchResults.length;
  const itemHeight = 30;
  const container = document.getElementById('search_results');
  const spacer = document.getElementById('spacer');
  const visibleItems = document.getElementById('visibleItems');

  spacer.style.height = (itemCount * itemHeight) + 'px';

  const scrollTop = container.scrollTop;

  const startIdx = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(container.clientHeight / itemHeight) + 1;
  const endIdx = Math.min(itemCount, startIdx + visibleCount);

  for (let i = startIdx; i < endIdx; i++){
    const item = G_currentSearchResults[i].file;
    try{
      if (!item.stat) item.stat = await fs.stat(path.join(item.path, item.name));
    }catch(err){
      // console.log(err);
    }
  }

  visibleItems.style.transform = `translateY(${startIdx * itemHeight}px)`;

  let html = '';
  for (let i = startIdx; i < endIdx; i++){
    const item = G_currentSearchResults[i].file;

    if (!item.stat) item.stat = {};

    const date = new Date(item.stat.mtime);
    const day = date.getDate() < 10 ? '0' + date.getDate() : date.getDate();
    const month = (date.getMonth()+1) < 10 ? '0' + (date.getMonth()+1) : (date.getMonth()+1);
    const minutes = date.getMinutes() < 10 ? '0' + date.getMinutes() : date.getMinutes();
    const hour = date.getHours() < 10 ? '0' + date.getHours() : date.getHours() ;
    const dateString = day + '/'+ month + '/' + date.getFullYear() + ' ' + hour + ':' + minutes;

    html+= `
      <div class='item' style='height: ${itemHeight}px'>
        <div class='fileName fileData' title='${escape(item.name)} \nPath: ${escape(item.path)}' data-path="${escape(item.path)}"><span>${escape(item.changedName) || escape(item.name)}</span></div>
        <div class='filePath fileData'>${escape(item.path)}</div>
        <div class='fileSize fileData'>${formatFileSize(item.stat.size) || ""}</div>
        <div class='fileMtime fileData'>${day ? dateString : "Unknown"}</div>
      </div>
    `
  }  
  visibleItems.innerHTML = html;
}

searchText.addEventListener('input', (e) => {
  let search = e.target.value;
  G_flags.lastKeyPress = Date.now();
  G_flags.updateSearch = true;
  G_flags.currentSearch = search;
})

document.getElementById('search_results').addEventListener('scroll', () => {
    renderSearch();
});

function updateLoop(){
  requestAnimationFrame(updateLoop);
  if (G_flags.updateSearch && Date.now() - G_flags.lastKeyPress > 200){
    searchFiles(G_flags.currentSearch);
    G_flags.updateSearch = false;
  }
}
updateLoop();

/** @type {HTMLDivElement} */
let G_currentSelectedName;

document.addEventListener('mousedown', (e) => {
  if (e.target.className.includes('fileName')){
    let div = e.target.children[0];
    if (G_currentSelectedName) G_currentSelectedName.classList.remove('fileName_selected');
    G_currentSelectedName = div;
    G_currentSelectedName.classList.add('fileName_selected');
  }
});
document.addEventListener('dblclick', (e) => {
  if (e.target.className.includes('fileName')){
    let path = e.target.dataset.path;
    shell.openPath(path);
  }
})

function escape(text){
  if (!text) return;
  const safeText = text.replace(/[&'`]/g, char => {
    return `\\${char}`; // escapes with backslash
  });
  return safeText;
}
function formatFileSize(bytes) {
  if (!bytes) return false;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(2)} ${sizes[i]}`;
}
window.onload = async () => {
  await findAllFilesmulti('C:/').catch(console.error);

  // await tryToLoadFiles();
  searchFiles("");

}
function escapeJsonString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\\/g, '\\\\') // Escape backslashes
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\n/g, '\\n') // Escape newlines
    .replace(/\r/g, '\\r') // Escape carriage returns
    .replace(/\t/g, '\\t') // Escape tabs
    .replace(/\f/g, '\\f') // Escape form feeds
    .replace(/\b/g, '\\b') // Escape backspaces
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, (c) => // Escape control characters
      `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
/**
 * @typedef workerObj
 * @property {number} i
 * @property {boolean} isBusy
 * @property {Worker} worker
 */
class ThreadPool{
    constructor(){
        this.isBusy = false;
        /** @type {workerObj[]} */
        this.currentWorkers = [];
    }
    loadWorkers(count = 1, fileName){
        if (this.isBusy) return false;
        this.isBusy = true;
        for (let i = 0; i < count; i++){
            this.currentWorkers.push({
                i: i,
                isBusy: false,
                worker: new Worker(path.resolve(__dirname, 'workers', fileName), {type: 'module'})
            })
        }
        return true;
    }
    terminateAll(){
        this.isBusy = false;
        for (let i = 0; i < this.currentWorkers.length; i++){
            let w = this.currentWorkers[i];
            w.worker.terminate();
        }
        this.currentWorkers = [];
    }
    getFreeWorker(){
        for (let i = 0; i < this.currentWorkers.length; i++){
            let w = this.currentWorkers[i];
            if (!w.isBusy) return w;
        }        
        return false;
    }
    async waitForWorker(needsWorkder){
        if (!needsWorkder) return false;
        return new Promise((resolve) => {
                let tries = 0;
                const interval = setInterval(() => {
                    const freeWorker = this.getFreeWorker();
                    if (freeWorker) {
                        clearInterval(interval);
                        resolve(freeWorker);
                    }
                    tries++;
                    if (tries > 1000000){
                        clearInterval(interval);
                        resolve(false);                
                    }
                }, 100); // Check every 100ms if a worker becomes free
            });
    }
}
const G_threadpool = new ThreadPool();
