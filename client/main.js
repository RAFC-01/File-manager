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
  const startTime = performance.now();
  let list = [];
  let mode = 0;
  if (search == '*') return files;
  if (search.substring(0, 2) == '*.' || search[0] == '.') mode = 1;
  for (let i = 0; i < files.length; i++){
    let f = files[i];
    if (mode == 0){
      let score = 0;
      let name = f.name.toLowerCase();
      if (name.includes(search)) score += 1;
      let searchIndex = name.indexOf(search);
      let changedName = f.name.substring(0, searchIndex) + '<b class="foundPart">' + f.name.substring(searchIndex, searchIndex + search.length) + '</b>' + f.name.substring(searchIndex + search.length, f.name.length);
      f.changedName = changedName;
      let lengthDiff = Math.abs(search.length - f.name.length);
      score += 1 - clamp(lengthDiff / 100, 0, 1);
      if (score > 1){
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

  fs.writeFile(path.join(savePath, 'saved_data.json'), JSON.stringify(files));
}

// findAllFiles('C:/').catch(console.error);
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
    item.stat = await fs.stat(item.path);
  }

  visibleItems.style.transform = `translateY(${startIdx * itemHeight}px)`;

  let html = '';
  for (let i = startIdx; i < endIdx; i++){
    const item = G_currentSearchResults[i].file;
    html+= `
      <div class='item' style='height: ${itemHeight}px'>
        <div class='fileName' title='${item.name} \nPath: ${item.path}' data-path="${item.path}">${item.changedName || item.name}</div>
        <div class='filePath'>${item.stat.mtime}</div>
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
    if (G_currentSelectedName) G_currentSelectedName.classList.remove('fileName_selected');
    G_currentSelectedName = e.target;
    G_currentSelectedName.classList.add('fileName_selected');
  }
});
document.addEventListener('dblclick', (e) => {
  if (e.target.className.includes('fileName')){
    let path = e.target.dataset.path;
    shell.openPath(path);
  }
})

window.onload = async () => {
  await tryToLoadFiles();
  searchText.value = "pixelart-editor"; 
  searchFiles("pixelart-editor");
}
