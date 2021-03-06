/**
 * Created by whis on 2/21/17.
 * 文件改动监测程序
 */
const fs = require('fs');
const getConfig = require('./config.js');
const logger = require('../../lib/logger');
const glob = require('glob-plus');
const watch = require('node-watch');
const watcher = require('watchr');

let _rootPath = '/';
let _relativePath = '';
let _recordsArray = [], _changedRecordsArray = [];
let _intervalLoop = null; //时间监测;
let _ignoreFilesNameArray = [];
let _ignoreFilesPathArray = [];
let _recordFilePath = '';
let _configJsonFile = '';
//格式化log打印
let _consoleLog = getConfig.consoleLog;
let _autoSave = 20;

/**
 * 获取运行参数
 * 如果没有传入,则默认当前文件夹下
 */
_watchPath = process.argv[1] ? process.argv[1] : './';

/**
 * 启动监测程序,把监测到改变了的文件路劲写入记录文件
 *
 * _changedRecordsArray 记录更改的文件,当记录的数量>=10个的时候,写入记录文件,以减少写入操作
 * _intervalLoop 辅助监测写入文件,如果更改记录没有达到100次, 辅助监测程序会在20秒之后把记录存入记录文件
 */
function startWatchProgram() {
    let stalker = watcher.create(_rootPath);
    stalker.on('change', function (changeType, fullPath, currentStat, previousStat) {
        let filename = fullPath;
        _consoleLog('变化的文件', filename);
        if (!repeatCheck(filename, _changedRecordsArray) && !ignoreCheck(filename, _ignoreFilesPathArray)) {
            _changedRecordsArray.push(filename);
            updateIntervalLoop();
        }
        if (_changedRecordsArray.length >= 100) {
            updateRecordFile(_changedRecordsArray);
        }
    });
    stalker.on('log', console.log);
    stalker.once('close', function (reason) {
        _consoleLog('Watcher closed!', _rootPath, ',because: ', reason);
        stalker.removeAllListeners();
    });

    let stalkerIgnoreFilesArray = [];
    for (let i = 0; i < _ignoreFilesNameArray.length; i++) {
        stalkerIgnoreFilesArray.push(_rootPath + _ignoreFilesNameArray[i]);
    }
    stalker.setConfig({
        stat: null,
        interval: 5007,
        persistent: true,
        catchupDelay: 2000,
        preferredMethods: ['watch', 'watchFile'],
        followLinks: true,
        ignorePaths: stalkerIgnoreFilesArray,
        ignoreHiddenFiles: true,
        ignoreCommonPatterns: true,
        ignoreCustomPatterns: null
    });

    function next(err) {
        if (err)  return console.log('watch failed on', _rootPath, 'with error', err);
        console.log('watch successful on', _rootPath)
    }

    stalker.watch(next);
    //stalker.close();
}

/**
 * 更新辅助监测程序
 */
function updateIntervalLoop() {
    clearInterval(_intervalLoop);
    _intervalLoop = setTimeout(function () {
        if (_changedRecordsArray.length > 0) {
            _consoleLog('提示', '辅助监测程序执行!');
            updateRecordFile(_changedRecordsArray);
        }
    }, _autoSave * 1000);
}

/**
 * 重复检测,避免重复记录
 * @param string
 * @param data
 * @returns {boolean}
 */
function repeatCheck(string, data) {
    let result = false;
    let length = data.length;
    for (let i = 0; i < length; i++) {
        if (data[i] == string) {
            result = true;
            break;
        }
    }
    // 如果是在忽略文件夹下,新增的,上面的无法匹配出来,所以再匹配一遍忽略的字段
    // 可能的问题是: 忽略掉不是在忽略文件夹下的与忽略字段同名的文件
    if (!result) {
        for (let i = 0; i < _ignoreFilesNameArray.length; i++) {
            let reg = new RegExp(_ignoreFilesNameArray[i]);
            if (string.match(reg)) {
                result = true;
                break;
            }
        }
    }
    return result;
}


/**
 * 监测是否是忽略的文件
 * 使用 == 绝对匹配
 * @param string
 * @param data
 * @returns {boolean}
 */
function ignoreCheck(string, data) {
    let result = false;
    let length = data.length;
    for (let i = 0; i < length; i++) {
        if (data[i] == string) {
            result = true;
            break;
        }
    }
    return result;
}

/**
 * 更新记录
 * @param recordsArray
 */
function updateRecordFile(recordsArray) {
    let _recordsArray = recordsArray;
    readRecordFile(_recordFilePath, 'utf8', function (data) {
        //_consoleLog('更新记录前读取的数据:',data);
        let diffArray = [];
        for (let i = 0; i < _recordsArray.length; i++) {
            for (let j = 0; j < data.length; j++) {
                if (_recordsArray[i] && _recordsArray[i] == data[j]) {
                    _recordsArray.splice(i, 1);
                }
            }
        }
        diffArray = _recordsArray;
        _consoleLog('匹配到的新的记录:', diffArray);
        //把不同的记录写入文件
        if (diffArray.length > 0) {
            writeRecordFile('\n' + diffArray.join('\n'), _recordFilePath, '', function () {
                //写入成功后,清空内存中记录的数组数据
                _changedRecordsArray = [];
            });
        }
    });
}

/**
 * 修改记录写入文件,如果没有文件会自动创建
 * @param record
 * @param recordFilePath
 * @param mode
 * @param callback
 */
function writeRecordFile(record, recordFilePath, mode, callback) {
    let _mode = mode ? mode : 'utf8';
    fs.appendFile(recordFilePath, record, 'utf8', function (err) {
        if (err) {
            console.log('==== 记录写入文件失败 ====');
            logger.error(err);
        }
        logger.trace('---- 记录写入文件成功 ----');
        if (callback) {
            callback();
        }
    });
}

/**
 * 读出记录文件的数据,处理成json或者array
 * 第一行默认是注释,数据从第二行开始,用"\n"分割
 * 如果记录文件没有,则创建文件,写入注释
 * @param recordFilePath
 * @param mode
 * @param callback
 */
function readRecordFile(recordFilePath, mode, callback) {
    checkFileExists(recordFilePath, '/** 此文件为文件变化监测记录,请勿删除 **/', 'utf8');
    let _mode = mode ? mode : 'utf8';
    fs.readFile(recordFilePath, _mode, function (err, data) {
        if (err) logger.error(err);
        let recordsArray = data.split('\n');
        _recordsArray = recordsArray;
        if (callback)
            callback(recordsArray);
    });
}

/**
 * 方法类型: 同步 ( 阻塞程序执行 )
 * 检查文件是否存在如果不存在则新建一个.
 * 使用同步的writeFileSync方法,如果文件不存在,改方法则会自动创建文件.
 * @param filePath
 */
function checkFileExists(filePath) {
    let exists = fs.existsSync(filePath);
    if (!exists) {
        fs.writeFileSync(filePath, '/** 此文件为文件变化监测记录,请勿删除 **/', 'utf8');
        _consoleLog('提示', '记录文件创建成功!');
    }
}

/**
 * 获取忽略的文件
 * @param callback
 */
function getIgnoreFiles(callback) {
    findIgnoreFiles(0, function () {
        if (callback)
            callback();
    });
}

/**
 * 递归获取忽略的文件的路径
 * @param n
 * @param callback
 *
 * 不使用 path.extname的原因是,记录文件的名字是".record",path.extname匹配不出扩展名
 */
function findIgnoreFiles(n, callback) {
    let matchString = '', string = _ignoreFilesNameArray[n];
    //如果有扩展名
    if (string.match(/\.\w+$/g)) {
        matchString = '**/' + string + '**';
    } else {
        //没有的则直接匹配文件夹下的所有文件
        matchString = string + '/**';
    }
    let plus = glob.plus(_relativePath + matchString);
    plus.on('file', ({name, stats, data}) => {
        let namePath = _rootPath + name;
        _ignoreFilesPathArray.push(namePath);
    });
    plus.on('end', () => {
        let index = n + 1;
        if (index < _ignoreFilesNameArray.length)
            findIgnoreFiles(index, callback);
        else {
            //_consoleLog('忽略的文件',_ignoreFilesPathArray);
            if (callback)
                callback();
        }
    })
}

/**
 * 启动程序,保证所有忽略文件都已经找到之后,再启动监测程序;
 */
getConfig.findConfigJsonFile((config) => {
    _relativePath = config.relativePath;
    _rootPath = config.rootPath;
    _configJsonFile = _rootPath + config.configFileName;
    _recordFilePath = _rootPath + config.recordFileName;
    _ignoreFilesNameArray = config.ignores;
    _autoSave = parseInt(config.autoSave);

    // 每次启动检测记录文件是否已经创建，如果已经创建就删除
    fs.exists(_recordFilePath, (exists) => {
        fs.unlink(_recordFilePath, (err) => {
            if (err) throw err;
            console.log('successfully deleted' + _recordFilePath);
        });
    });

    getIgnoreFiles(startWatchProgram);
});
