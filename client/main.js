const os = require('os');
const {shell} = require('electron');
const fs = require('fs');
const fg = require('fast-glob');
const path = require('path');
const driveList = require('drivelist');

const searchText = document.getElementById('search');
const searchInfo = document.getElementById('searchInfo');

const options = {
  ignoredPaths: ['C:\\Windows', '$Recycle.Bin']
}

const G_navList = [];
let currentLocationIndex = 0;

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
const APPNAME = 'FileManager';

const FEW_MINUTES_TEXT = "To może potrwać kilka minut!";

let currentLocation = 'main'; // id of current location

const savePath = path.join(APPDATA, APPNAME);

if (!dirExists(savePath)){
  fs.mkdir(savePath);
}

let isLoading = false;
let loadingDots = 0;

const loadingScreenDiv = document.getElementById('loadingScreen');
const loadingScreenText = document.getElementById('loadingText');
const loadingScreenSubText = document.getElementById('loadingSubText');

let G_lastUpdateTime = Date.now();
function updateLoadingText(){
  if (!isLoading) return;

  if (Date.now() - G_lastUpdateTime < 200) return; // slow down to 20 fps

  const dots = '...';

  loadingDots--;

  loadingDots = loadingDots % 3;

  loadingScreenText.innerText = 'Ładowanie' + dots.slice(loadingDots, dots.length);
  G_lastUpdateTime = Date.now();
}

function startLoading(subtext = ""){
  isLoading = true;
  loadingScreenDiv.style.display = 'flex';
  loadingScreenSubText.innerHTML = subtext;
}

function stopLoading(){
  isLoading = false;
  loadingScreenDiv.style.display = 'none';
}

const G_flags = {
  updateSearch: false,
  mainPageReady: false
};

const G_icons = {
  'code': {x: 0, y: 0, sizeX: 16, sizeY: 16},
  'other': {x: 128, y: 0, sizeX: 16, sizeY: 16},
  'photo': {x: 32, y: 0, sizeX: 16, sizeY: 16},
  'config': {x: 16, y: 0, sizeX: 16, sizeY: 16},
  'folder': {x: 48, y: 0, sizeX: 16, sizeY: 16},
  'video': {x: 112, y: 0, sizeX: 16, sizeY: 16},
  'executable': {x: 96, y: 0, sizeX: 16, sizeY: 16},
  'text': {x: 64, y: 0, sizeX: 16, sizeY: 16},
  'sound': {x: 80, y: 0, sizeX: 16, sizeY: 16},
}

async function tryToLoadFiles(){
  startLoading();
  try {
    const filePath = path.join(savePath, 'saved_data.json');
    if(fs.existsSync(filePath)){
      let data = await fs.promises.readFile(filePath);
      files = JSON.parse(data);
    }else{
      loadingScreenSubText.innerHTML = FEW_MINUTES_TEXT;
      await findAllFilesmulti('C:/').catch(console.error);
    }
    stopLoading();
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
const BATCH_SIZE = 10000; // Adjust based on memory
const ROOT_DIR = 'C:/'; // Test with smaller dir first

async function getFileMetadata(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) return null; // Skip non-files
    const name = path.basename(filePath);
    const ext = path.extname(name).toLowerCase().slice(1);
    return {
      path: filePath,
      name,
      size: stats.size,
      modified_at: stats.mtime.toISOString(),
      type: ext || 'unknown',
    };
  } catch (err) {
    console.error(`Error stat ${filePath}: ${err.message}`);
    return null;
  }
}

async function insertBatch(batch) {
  if (batch.length === 0) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO files (path, name, size, modified_at, type) VALUES (?, ?, ?, ?, ?)'
  );
  const transaction = db.transaction((items) => {
    for (const item of items) {
      insert.run(item.path, item.name, item.size, item.modified_at, item.type);
    }
  });

  try {
    transaction(batch);
    console.log(`Inserted ${batch.length} files`);
  } catch (err) {
    console.error(`Batch insert error: ${err.message}`);
  }
}
let skippedFiles = [];
async function scanAndStore() {
  console.time('Scan and Store');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('DROP INDEX IF EXISTS idx_path; DROP INDEX IF EXISTS idx_name;');

  try {
    const files = fg.stream(['**/*'], {
      cwd: ROOT_DIR,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      suppressErrors: true, // Attempt to suppress EPERM errors
      dot: true,
    });

    let batch = [];
    let fileCount = 0;

    await new Promise((resolve, reject) => {
      files.on('data', async (filePath) => {
        try {
          const metadata = await getFileMetadata(filePath);
          if (metadata) {
            batch.push(metadata);
            fileCount++;
            if (batch.length >= BATCH_SIZE) {
              await insertBatch(batch);
              batch = [];
              console.log(`Processed ${fileCount} files`);
            }
          }
        } catch (err) {
          skippedFiles.push({ path: filePath, error: err.message });
          console.error(`File processing error for ${filePath}: ${err.message}`);
        }
      });

      files.on('error', (err) => {
        // Log stream errors without rejecting
        skippedFiles.push({ path: err.path || 'unknown', error: err.message });
        console.error(`Stream error: ${err.message}`);
      });

      files.on('end', async () => {
        try {
          await insertBatch(batch);
          console.log(`Total files processed: ${fileCount}`);
          console.log(`Skipped files/directories:`, skippedFiles);
          resolve();
        } catch (err) {
          console.error(`Final batch error: ${err.message}`);
          resolve(); // Resolve to avoid crashing
        }
      });

      files.on('close', () => {
        console.log('Stream closed');
      });
    });

    // Recreate indexes
    db.exec('CREATE INDEX idx_path ON files (path);');
    db.exec('CREATE INDEX idx_name ON files (name);');
    db.exec('ANALYZE; VACUUM;');
  } catch (err) {
    console.error(`Scan error: ${err.message}`);
  }

  console.timeEnd('Scan and Store');
  // Log skipped files for user visibility
  if (skippedFiles.length > 0) {
    console.log(`Total skipped files/directories: ${skippedFiles.length}`);
    console.log('Skipped details:', skippedFiles);
  }
}
async function dirExists(path) {
  try {
    const stats = await fs.promises.stat(path);
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
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
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
function makeSureFileExists(path){
    if (!fs.existsSync(path)){
        fs.writeFileSync(path, '[]');
    }    
}
async function findAllFilesmulti(dir = ':/') {
  console.time('find files multi');
  files = [];
  let currentLength = 0;
  let done = 0;

  G_threadpool.loadWorkers(1, 'readFile.js');

  // limiter(fn) will:
  //  - if active.size < concurrency, immediately start fn()
  //  - otherwise wait until any active task finishes (Promise.race), then start fn()
  // It returns the Promise that represents fn().
  return new Promise(async (resolve) => {

    async function checkDir(currentDir) {
      if (currentDir.includes('C:\\Windows')) {
          return
      };


      let entries;
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
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
                files = e.data;
                if (done >= dirLength){
                  console.timeEnd('find files multi');
                  await fs.promises.writeFile(path.join(savePath, 'saved_data.json'), JSON.stringify(files));
                  resolve();
                }
                // searchFiles(G_lastSearch)
              }
          }
        }
      } 
  
      await checkDir(dir)

      console.log(`Total entries visited: ${currentLength}`);
    })


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
      if (!item.stat) item.stat = await fs.promises.stat(path.join(item.path, item.name));
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
async function prepareIcons(){
  return new Promise(resolve => {
    const styleElement = document.createElement('style');
    
    const image = new Image();
    image.src = 'icons.png';
  
    image.onload = () => {
      styleElement.textContent = `
      .icon{
        width: ${image.width}px;
        height: ${image.height}px;
        background-image: url('icons.png');
        background-repeat: no-repeat;
        background-size: cover;
      }
      `;

      document.head.appendChild(styleElement);
      resolve()
    }
  })
}
function makeUIicon(x, y, xSize, ySize){
  const mainDiv = createDivElement({
    width: xSize + 'px',
    height: ySize + 'px',
    flexShrink: '0',
    overflow: 'hidden'
  })
  const backgroundDiv = createDivElement({
    backgroundPositionX: -x + 'px',
    backgroundPositionY: -y + 'px',
  }, 'icon');

  mainDiv.appendChild(backgroundDiv);

  return mainDiv;
}
const navBack = document.getElementById('backArrow');
const navForward = document.getElementById('forwardArrow');

navBack.addEventListener('mousedown', () => {
  if (!navBack.classList.contains('active')) return;
  currentLocationIndex -= 1;

  navigateTo(G_navList[currentLocationIndex]);

});

navForward.addEventListener('mousedown', () => {
  if (!navForward.classList.contains('active')) return;
  currentLocationIndex += 1;

  navigateTo(G_navList[currentLocationIndex]);
  
});

function updateNavBtns(){

  if (currentLocationIndex == 0) navBack.classList.remove('active');
  else navBack.classList.add('active');

  if (currentLocationIndex == G_navList.length - 1) navForward.classList.remove('active');
  else navForward.classList.add('active');
}
function formatFileSize(bytes, props = {}) {
  if (bytes === undefined) return false;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `<span class="${props.valueClass || 'unset'}">${size.toFixed(2)}</span> <span class="${props.sizeClass || 'unset'}" >${sizes[i]}</span>`;
}
window.onload = async () => {
  // await findAllFilesmulti('C:/').catch(console.error);
  await prepareIcons();
  await tryToLoadFiles();
  await createMainGraphs();
  // const testDrive = {
  //   "path": "C:\\",
  //   "size": 256060514304,
  //   "free": 6553714688,
  //   "desc": "SAMSUNG MZVLB256HAHQ-000H1",
  //   "name": "C",
  //   "color": "var(--niceRed)"
  // }
  
  // await goToSingleView(testDrive.name + ' - ' + testDrive.desc, testDrive);
  searchFiles("");

  // goToSingleView("C - samsung");
  setInterval(() => {
    updateNavBtns();
    updateLoadingText();
  },100); // 10 fps
}
/**
 * Creates a div element with the specified styles.
 * @param {Partial<CSSStyleDeclaration>} styles
 * @returns {HTMLDivElement}
 */
function createDivElement(styles = {}, className, dataset = {}){
    const div = document.createElement('div');
    for (let i = 0; i < Object.keys(styles).length; i++){
        let key = Object.keys(styles)[i];    
        let value = Object.values(styles)[i];
        
        if (key == 'centerFlex'){
            div.style['display'] = 'flex';
            div.style['justifyContent'] = 'center';
            div.style['alignItems'] = 'center';
        }else{
            div.style[key] = value;
        }
    }
    if (className) div.className = className;
    let datasetArr = Object.keys(dataset);
    for (let i = 0; i < datasetArr.length; i++){
        let key = datasetArr[i];
        let value = dataset[key];
        div.dataset[key] = value;

    }

    return div;
}
function createNameWithTitleDiv(title, value){
  const mainDiv = createDivElement({
    display: 'flex',
    flexDirection: 'column',
    width: 'fit-content'
  });

  const titleDiv = createDivElement({
    color: 'var(--fontColor)'
  });

  const valueDiv = createDivElement({
    color: 'white'
  });
  titleDiv.innerHTML = title;
  valueDiv.innerHTML = value;

  mainDiv.appendChild(titleDiv);
  mainDiv.appendChild(valueDiv);

  return {mainDiv, valueDiv};
}
function createLegendDot(color, name){
  const mainDiv = createDivElement({
    display: 'flex',
    gap: '10px',
    alignItems: 'center'
  });

  const dotDiv = createDivElement({
    backgroundColor: color,
    borderRadius: '50%',
    width: '10px',
    height: '10px',
  });

  const nameDiv = createDivElement({
    color: 'var(--fontColor)'
  });
  nameDiv.innerHTML = name;

  mainDiv.appendChild(dotDiv);
  mainDiv.appendChild(nameDiv);
  return mainDiv;
}
function createGraphBar(height, number, name, icon = {}){
  const mainDiv = createDivElement({
    display: 'flex',
    flexDirection: 'column',
    width: '30px',
    height: '85%',
    justifyContent: 'flex-end',
  });
  mainDiv.title = name;

  const topIcon = makeUIicon(icon.x, icon.y, icon.sizeX, icon.sizeY);
  topIcon.style.marginTop = '-18px'

  const barDiv = createDivElement({
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '2px'
  });

  const innerBar = createDivElement({
    borderRadius: '5px',
    height: height,
    backgroundColor: 'var(--niceBlue)',
    width: '100%',
    display: 'flex',
    justifyContent: 'center'
  })
  
  barDiv.appendChild(innerBar);
  innerBar.appendChild(topIcon);
  
  const numberDiv = createDivElement({
    color: 'var(--fontColor)',
    fontSize: '11px',
    textAlign: 'center',
    width: '100%'
  })

  numberDiv.innerHTML = number;

  mainDiv.appendChild(barDiv);
  mainDiv.appendChild(numberDiv);

  return mainDiv;
}
function shortenNumber(num) {
    if (typeof num !== 'number' || isNaN(num)) return '0';
    
    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    
    if (absNum >= 1e9) {
        return sign + (absNum / 1e9).toFixed(0).replace(/\.0$/, '') + 'B';
    }
    if (absNum >= 1e6) {
        return sign + (absNum / 1e6).toFixed(0).replace(/\.0$/, '') + 'M';
    }
    if (absNum >= 1e3) {
        return sign + (absNum / 1e3).toFixed(0).replace(/\.0$/, '') + 'K';
    }
    return sign + num.toString();
}
function makeGraphInfo(info = {}, color){
  const mainDiv = createDivElement({
    width: '190px',
    height: '190px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  }, 'smallWindow diskInfo');

  const header = createDivElement({
    width: '90%',
    padding: '10px 0px'
  });

  const chartDiv = createDivElement({
    width: '90%',
    display: 'flex',
    justifyContent: 'center'
  });

  const takenProcentage = (100 - info.free / info.size * 100).toFixed(2);

  const pieChartDiv = createDivElement({
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    background: `conic-gradient(${color} 0% ${takenProcentage}%, var(--fontColor) ${takenProcentage}% 100%)`,
    centerFlex: 1
  });

  const pieChartCenter = createDivElement({
    width: '70px',
    height: '70px',
    borderRadius: '50%',
    backgroundColor: 'var(--frontColor)'
  });

  pieChartDiv.appendChild(pieChartCenter);

  chartDiv.appendChild(pieChartDiv);

  const brandDiv = createDivElement({
    width: '90%',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    padding: '5px 0px',
    marginTop: '10px',
    borderTop: '1px solid var(--borderColor)'
  });


  header.innerHTML = `${info.name} - <span style='font-size: 13px; color: ${color};'>${formatFileSize(info.free)} / ${formatFileSize(info.size)}</span>`;
  brandDiv.innerHTML = info.desc || 'nieznana marka';
  brandDiv.title = info.desc;

  mainDiv.appendChild(header);
  mainDiv.appendChild(chartDiv);
  mainDiv.appendChild(brandDiv);

  return mainDiv;
}
function changeLocation(old, _new){
  window.scrollTo({top: 0});

  document.getElementById(old).style.display = 'none';
  document.getElementById(_new).style.display = 'flex';

  if (_new == 'quickSearch') document.body.style.overflowY = 'hidden';
  else document.body.style.overflowY = 'auto';

  currentLocation = _new;
}
function navigateTo(nav){
  window.scrollTo({top: 0});
  if (nav.name == "main") goToMain(true);
  if (nav.name == "singleView"){
    goToSingleView(nav.viewName, nav.viewData, true);
  }
  if (nav.name == 'quickSearch'){
    goToSearch(true);
    document.body.style.overflowY = 'hidden';
  }else{
    document.body.style.overflowY = 'auto';
  }
}
function addToNavList(obj = {}){
  // cut until current location
  G_navList.splice(currentLocationIndex+1, G_navList.length);
  G_navList.push(obj);
  currentLocationIndex = G_navList.length - 1;  
}
function goToMain(isNav){
  if (!G_flags.mainPageReady) return;
  changeLocation(currentLocation, "main");
  if (!isNav) {
    addToNavList({name: 'main'});
  }
}
async function createMainGraphs(){
  document.getElementById('main').style.display = 'flex';
  const totalDiv = createNameWithTitleDiv('Cała pamięć', formatFileSize(0, {sizeClass: 'headerSize', valueClass: 'headerValue'}));
  const freeDiv = createNameWithTitleDiv('Wolna pamięć', formatFileSize(0, {sizeClass: 'headerSize', valueClass: 'headerValue'}));
  const headersDiv = document.querySelector('.headers');
  const legendDiv = document.getElementById('spaceLegend');
  const drivesDiv = document.getElementById('drives');

  headersDiv.appendChild(totalDiv.mainDiv);
  headersDiv.appendChild(freeDiv.mainDiv);
  const drives = await driveList.list();

  console.log(drives);

  let driveMem = [];

  let totalFree = 0;
  let totalSpace = 0;

  const graphLineDiv = document.getElementById('graphLine');

  for (let i = 0; i < drives.length; i++){
    let d = drives[i];
    let drivePath = d.mountpoints[0].path;
    let driveName = drivePath[0];

    let { free } = await getDiskFreeSpace(drivePath);

    totalSpace+=d.size;
    totalFree+=free;

    driveMem.push({
      path: drivePath,
      size: d.size,
      free: free,
      desc: d.description,
      name: driveName
    });

  }
  const barColors =  ['var(--niceRed)', 'var(--niceBlue)'];
  // i need totalSpace
  for (let i = 0; i < driveMem.length; i++){
    let d = driveMem[i];
    const linePart = createDivElement({
      width: Math.floor((d.size - d.free) / totalSpace * 1000) / 10 + '%',
      backgroundColor: barColors[i % barColors.length],
      height: '100%'
    });

    legendDiv.appendChild(createLegendDot(barColors[i % barColors.length], d.name));

    graphLineDiv.appendChild(linePart);

    // drives info
    const drive = makeGraphInfo(d, barColors[i % barColors.length]);

    d.color = barColors[i % barColors.length];

    drive.addEventListener('click', () => {
      goToSingleView(d.name + ' - ' + d.desc, d);
    })

    drivesDiv.appendChild(drive);
  }

    legendDiv.appendChild(createLegendDot('var(--fontColor)', 'Wolne'));

  totalDiv.valueDiv.innerHTML = formatFileSize(totalSpace, {sizeClass: 'headerSize', valueClass: 'headerValue'});
  freeDiv.valueDiv.innerHTML = formatFileSize(totalFree, {sizeClass: 'headerSize', valueClass: 'headerValue'});

  document.getElementById('diskAmmout').innerHTML = drives.length;


  let types = {};

  for (let i = 0; i < files.length; i++){
    let fileName = files[i].name;
    if (fileName[0] == '.') continue;
    let type;
    if (!fileName.includes('.')){
      // probably a folder 
      type = 'folder';
    }else{
      let ext = fileName.substring(fileName.lastIndexOf('.'), fileName.length);
      
      type = getFileType(ext);
    }

    if (!types[type]) types[type] = 0;
    types[type]++;
  }
  document.getElementById('totalFiles').innerHTML = addCommas(files.length) + " <span style='font-size: 15px; font-weight: normal; color: var(--fontColor);'>Plików</span>";

  const sortedTypes = Object.keys(types).sort((a, b) => types[b] - types[a]);

  const distGrapthDiv = document.getElementById('distGrapth');

  for (let i = 0; i < sortedTypes.length; i++){
    const type = types[sortedTypes[i]];
    const biggest = types[sortedTypes[0]];
    
    const procentage = type / biggest * 100;
    const graphDiv = createGraphBar(procentage + '%', shortenNumber(type), addCommas(type) + ' ' + sortedTypes[i], G_icons[sortedTypes[i]]);

    distGrapthDiv.appendChild(graphDiv);
  }
  G_flags.mainPageReady = true;
  addToNavList({name: 'main'})

  console.log(driveMem[0])

}
function addCommas(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function getFileType(extension) {
  const fileTypes = {
    code: ['.js', '.ts', '.py', '.rs', '.java', '.cpp', '.html', '.css', '.c', '.h', '.hpp', '.h', '.lua', '.odin', '.jai'],
    executable: ['.exe', '.bin', '.sh', '.bat', '.dll'],
    config: ['.json', '.yaml', '.ini', '.toml', '.env', '.dat'],
    text: ['.txt', '.md', '.log', '.csv', '.todo', '.pdf', '.doc', '.docx'],
    photo: ['.png', '.jpg', '.webp', '.jpeg'],
    video: ['.gif', '.mp4', '.mov', '.avi', '.webm'],
    sound: ['.mp3', '.av', '.flac', '.aac', '.ogg']
  };
  extension = extension.toLowerCase();
  for (const [type, exts] of Object.entries(fileTypes)) {
    if (exts.includes(extension)) return type;
  }
  return extension ? 'other' : 'unknown';
}
async function getDiskFreeSpace(dir) {
  const stats = await fs.promises.statfs(dir);
  const freeBytes = stats.bfree * stats.bsize; 
  const totalBytes = stats.blocks * stats.bsize;
  const free = freeBytes; 
  const total = totalBytes; 
  return { free, total };
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
              if (tries > 10000){
                  clearInterval(interval);
                  resolve(false);                
              }
          }, 100);
        });
    }
}
const G_threadpool = new ThreadPool();

async function goToSingleView(name, data = {}, isNav){
  document.getElementById(currentLocation).style.display = 'none';
  document.getElementById('singleLocationView').style.display = 'flex';
  const content = document.getElementById('singleViewContent');
  content.innerHTML = '';

  currentLocation = 'singleLocationView';
  
  const header = createDivElement({

  }, 'headLine')
  
  header.innerHTML = name || "";
  const diskInfoDiv = createDivElement({
    minWidth: '580px',
    maxWidth: '1000px',
    height: '150px',
    display: 'flex',
    alignItems: 'center',
    padding: '10px'
  }, 'smallWindow');

  const takenProcentage = (100 - data.free / data.size * 100).toFixed(2);
  const freeProcentage = (100 - takenProcentage).toFixed(2);

  let color = data.color;

  const pieChartDiv = createDivElement({
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    background: `conic-gradient(${color} 0% ${takenProcentage}%, var(--fontColor) ${takenProcentage}% 100%)`,
    centerFlex: 1,
    marginLeft: '10px',
    flexShrink: '0'
  });

  const pieChartCenter = createDivElement({
    width: '70px',
    height: '70px',
    borderRadius: '50%',
    backgroundColor: 'var(--frontColor)'
  });

  pieChartDiv.appendChild(pieChartCenter);

  content.appendChild(header);
  diskInfoDiv.appendChild(pieChartDiv);
  content.appendChild(diskInfoDiv);

  // stats left
  const statsLeftDiv = createDivElement({
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginLeft: '20px',
    flexShrink: '0'
  });

  const freeSpace = createNameWithTitleDiv('Wolne', formatFileSize(data.free, {sizeClass: 'headerSize', valueClass: 'headerValue'}));
  const overallSpace = createNameWithTitleDiv(`<span style="color: ${color}">Zajęte<span>`, formatFileSize(data.size - data.free, {sizeClass: 'headerSize', valueClass: 'headerValue'}));

  statsLeftDiv.appendChild(freeSpace.mainDiv);
  statsLeftDiv.appendChild(overallSpace.mainDiv);

  const statsRightDiv = createDivElement({
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginLeft: '20px',
    height: '100%',
    width: '100%',
    alignItems: 'flex-end'
  });

  const warningsDiv = createDivElement({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '5px'
  });


  const warnings = [
    {
      condition: freeProcentage < 5,
      warningMessage: 'Mało miejsca',
      title: 'Mniej niż 5% wolnego miejsca!'
    },
  ]

  for (let i = 0; i < warnings.length; i++){
    if (warnings[i].condition){
      const warningDiv = createDivElement({
        width: 'fit-content',
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        color: 'var(--fontColor)',
        border: '2px solid var(--fontColor)',
        backgroundColor: 'var(--backColor)',
        borderRadius: '7px',
        padding: '4px 10px',
        fontSize: '14px',
        userSelect: 'none'
      });

      warningDiv.title = warnings[i].title;

      const icon = makeUIicon(144, 0, 16, 16);
      icon.style.marginTop = '4px';
      warningDiv.appendChild(icon);
      warningDiv.innerHTML += warnings[i].warningMessage;


      warningsDiv.appendChild(warningDiv);
      
    }
  }
  statsRightDiv.appendChild(warningsDiv);

  const bottomButtonsDiv = createDivElement({
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: '6px'
  });

  /**
   * 
   * @param {Array<{path: string, size: number, isFile: boolean}>} arr 
   * @returns 
   */
  const getDuplicates = (arr = []) => {
    const data = {};

    for (let i = 0; i < arr.length; i++){
      if (arr[i].isFile) continue;

      const name = path.basename(arr[i].path);

      data[name] === undefined ? data[name] = 1 : data[name]++;
    }

    const sorted = Object.keys(data).sort((a, b) => data[b] - data[a]); 

    const topAmmArr = [];

    const topAmm = 64 > sorted.length ? sorted.length : 64;

    for (let i = 0; i < topAmm; i++){
      topAmmArr.push({
        name: sorted[i],
        amm: data[sorted[i]]
      })
    }

    return topAmmArr;
  }

  const handleLocationData = (data) => {
    const sorted = data.sort((a, b) => b.size - a.size);
    const duplicatesList = getDuplicates(sorted);

    const fileStatsDiv = createDivElement({
      width: '100%',
      display: 'flex',
      gap: '20px',
      marginBottom: '20px'
    });

    const top10FileSize = createDivElement({
      width: '100%',
      minWidth: '400px',
      height: '400px',
      padding: '10px'
    }, 'smallWindow');

    const duplicateDiv = createDivElement({
      width: '300px',
      flexShrink: '0',
      height: '400px',
      padding: '10px',
      overflow: 'hidden'
    }, 'smallWindow');

    fileStatsDiv.appendChild(top10FileSize)
    fileStatsDiv.appendChild(duplicateDiv);

    const top10FileList = sorted.slice(0, 10);

    let maxSize = top10FileList[0].size;

    for (let i = 0; i < top10FileList.length; i++){
      top10FileSize.appendChild(makeUIFileSizeGraph(top10FileList[i].path, {size: top10FileList[i].size, maxSize: maxSize}));
    }

    const dupLen = 16 > duplicatesList.length ? duplicatesList.length : 16;

    for (let i = 0; i < dupLen; i++){
      duplicateDiv.appendChild(makeUIListItem(duplicatesList[i].name, duplicatesList[i].amm));
    }

    content.appendChild(fileStatsDiv);
  }


  const fileSpaceDistribution = makeUIButton('Statystyki Plików', '150px', '30px', 'var(--niceYellow)');
  fileSpaceDistribution.onclick = async () => {
    startLoading(FEW_MINUTES_TEXT);
    const res = await fileScanPath(data.path);
    stopLoading();
    handleLocationData(res);
  }
  const searchFilesBtn = makeUIButton('Szukaj Plików', '150px', '30px');

  searchFilesBtn.onclick = () => {
    goToSearch();
  } 

  bottomButtonsDiv.appendChild(fileSpaceDistribution);
  bottomButtonsDiv.appendChild(searchFilesBtn);

  statsRightDiv.appendChild(bottomButtonsDiv);

  diskInfoDiv.appendChild(statsLeftDiv);
  diskInfoDiv.appendChild(statsRightDiv);


  // try to get old (cached) Data
  const filePath = path.join(savePath, `wholeData_${data.path[0]}.json`)
  if (fs.existsSync(filePath)){
    try{
      startLoading();
      const oldData = await fs.promises.readFile(filePath);
      handleLocationData(JSON.parse(oldData))
      stopLoading();
    }catch(e){
      console.error(e);
    }
  }

  if (!isNav){
    addToNavList({name: 'singleView', viewName: name, viewData: data});
  }
}
function makeUIListItem(name, amm){
  const mainDiv = createDivElement({

  });

  mainDiv.innerHTML = name + ' - ' + amm;

  return mainDiv;
}
function makeUIFileSizeGraph(name, props = {}){
  const mainDiv = createDivElement({
    display: 'flex',
    flexDirection: 'column',
    width: '90%',
    gap: '4px',
  });

  const nameDiv = createDivElement({

  });

  nameDiv.innerHTML = name + ' - ' + formatFileSize(props.size, {sizeClass: 'headerSize'});

  const graphLine = createDivElement({
    width: props.size / props.maxSize * 100 + '%',
    height: '14px',
    backgroundColor: 'var(--niceBlue)',
    borderRadius: '7px'
  });

  mainDiv.appendChild(nameDiv);
  mainDiv.appendChild(graphLine);

  return mainDiv;
}
function makeUIButton(value, width, height, color = 'var(--niceBlue)'){
  const mainDiv = createDivElement({
    centerFlex: 1,
    width: width,
    height: height,
    backgroundColor: color,
    borderRadius: '7px',
    paddingBottom: '1px',
    cursor: 'pointer'
  }, 'UI_button');

  const textDiv = createDivElement({
    fontWeight: '500'
  });

  textDiv.innerHTML = value;

  mainDiv.appendChild(textDiv);

  return mainDiv;
}
async function fileScanPath(filePath = 'C:/'){
  const worker = new Worker(path.resolve(__dirname, 'workers', 'getAllDirInfo.js'), {type: 'module'})

  worker.postMessage({path: filePath, ignored: options.ignoredPaths});

  console.time('read size');

  return new Promise((resolve)=> {
    worker.onmessage = async (e) => {
  
      // only save as first char of the disk path for now
      await fs.promises.writeFile(path.join(savePath, `wholeData_${filePath[0]}.json`), JSON.stringify(e.data));
  
      console.timeEnd('read size');
      resolve(e.data);
    }
  })
}
function goToSearch(isNav){
  changeLocation(currentLocation, "quickSearch");

  if (!isNav){
    addToNavList({name: 'quickSearch'});
  }
}