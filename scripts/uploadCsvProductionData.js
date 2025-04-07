"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var jsdom_1 = require("jsdom");
var path = require("path");
var promises_1 = require("fs/promises");
// const wellApiNumber = `30-015-27892`
var wellApiNumber = "30-045-29202";
var productionUrl = "https://wwwapps.emnrd.nm.gov/OCD/OCDPermitting/Data/ProductionSummaryPrint.aspx?report=csv&api=".concat(wellApiNumber);
console.log("Production URL: ", productionUrl);
var wellFileUrl = "https://ocdimage.emnrd.nm.gov/imaging/WellFileView.aspx?RefType=WF&RefID=".concat(wellApiNumber.replaceAll("-", ""), "0000");
console.log('Well File URL: ', wellFileUrl);
function saveStringToFile(content, filename) {
    return __awaiter(this, void 0, void 0, function () {
        var error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.mkdir)(path.dirname(filename), { recursive: true })];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, (0, promises_1.writeFile)(filename, content, 'utf8')];
                case 2:
                    _a.sent();
                    console.log('File has been saved successfully');
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    console.error('Error writing to file:', error_1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function parseHtmlTableToArrays(htmlContent) {
    return __awaiter(this, void 0, void 0, function () {
        var dom, doc, tables, columnNameElements, columnNames, csvRows, i, cells, rowData, _i, _a, cell;
        var _b;
        return __generator(this, function (_c) {
            dom = new jsdom_1.JSDOM(htmlContent);
            doc = dom.window.document;
            tables = doc.getElementsByTagName('table');
            if (tables.length === 0)
                return [2 /*return*/];
            columnNameElements = tables[0].getElementsByTagName('tr')[2].getElementsByTagName('td');
            columnNames = Array.from(columnNameElements).map(function (element) { var _a; return ((_a = element.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || ''; }).slice(0, 7);
            csvRows = [columnNames];
            // const dataColumns: {[name: string]: string[]} = {}
            // Iterate through each table
            for (i = 1; i < tables.length; i++) {
                cells = tables[i].getElementsByTagName('tr')[0].getElementsByTagName('td');
                rowData = [];
                // // Handle header cells
                // for (let cell of cellsHeader) {
                //     rowData.push(cell.textContent?.trim() || '');
                // }
                // Handle data cells
                for (_i = 0, _a = Array.from(cells).slice(0, 7); _i < _a.length; _i++) {
                    cell = _a[_i];
                    rowData.push(((_b = cell.textContent) === null || _b === void 0 ? void 0 : _b.trim()) || '');
                }
                // Add the row to our CSV data, properly escaped
                if (rowData.length > 0) {
                    csvRows.push(rowData.map(function (cell) { return "".concat(cell.replace(/"/g, '""')); }));
                }
            }
            return [2 /*return*/, csvRows];
        });
    });
}
var main = function () { return __awaiter(void 0, void 0, void 0, function () {
    var response, htmlContent, csvContent, csvContentWithDate, csvContentString, productionFilePath;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, fetch(productionUrl)];
            case 1:
                response = _a.sent();
                return [4 /*yield*/, response.text()];
            case 2:
                htmlContent = _a.sent();
                return [4 /*yield*/, parseHtmlTableToArrays(htmlContent)];
            case 3:
                csvContent = _a.sent();
                if (!csvContent)
                    return [2 /*return*/];
                csvContentWithDate = [__spreadArray(["FirstDayOfMonth"], csvContent[0], true)];
                csvContentWithDate.push.apply(csvContentWithDate, csvContent.slice(1).map(function (row) { return (__spreadArray([
                    new Date("".concat(row[2], " 1, ").concat(row[0])).toISOString().split('T')[0]
                ], row, true)); }));
                csvContentString = csvContentWithDate.map(function (row) { return row.join(','); }).join('\n');
                productionFilePath = path.join('.', 'tmp', 'production-agent', 'structured-data-files', 'monthly_produciton', "api=".concat(wellApiNumber), 'production.csv');
                return [4 /*yield*/, saveStringToFile(csvContentString, productionFilePath)
                    // console.log(csvContentString);
                ];
            case 4:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
main();
