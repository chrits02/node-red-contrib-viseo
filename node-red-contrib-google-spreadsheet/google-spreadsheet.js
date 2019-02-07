const fs = require('fs');
const helper = require('node-red-viseo-helper');
const google = require('googleapis');
const sheets = google.sheets('v4');


// --------------------------------------------------------------------------
//  NODE-RED
// --------------------------------------------------------------------------

module.exports = function(RED) {
    const register = function(config) {
        RED.nodes.createNode(this, config);
        let node = this;
        node.status({fill:"red", shape:"ring", text: 'Missing credential'})
        if (config.auth) {
            node.auth = RED.nodes.getNode(config.auth);
            node.status({});
        }

        this.on('input', (data)  => { input(node, data, config,) });
    }
    RED.nodes.registerType("google-spreadsheet", register, {});
}

function input (node, data, config) {

    let action = config.action || 'set',
        spreadsheetId = config.sheet,
        range = config.range,
        save = config.save || '_sheet';

    if (config.sheetType !== 'str') {
        spreadsheetId = getFromType(config.sheetType, spreadsheetId);
    }
    if (config.rangeType !== 'str') {
        range = getFromType(config.rangeType, range);
  
    }

    let saveField = range.replace(/[!:'" ]/g, "_");

    let saveLoc = getFromType(config.saveType, save) || {};
    setFromType(config.saveType, save, saveLoc);

    let parameters = { spreadsheetId, range };
    let method = config.method || 'append';


    function getFromType(type, key) {
        if(type === "global") {
            return node.context().global.get(key);
        } else {
            return helper.getByString(data, key);
        }
    }

    function setFromType(type, key, value) {
        if(type === "global") {
            return node.context().global.set(key, value);
        } else {
            return helper.setByString(data, key, value);
        }
    }

    function querySet() {

        // Get input fields
        let rows = getFromType(config.inputType, config.input || "payload");

        if (!rows || rows.length < 1) {
            node.error("Input object is empty");
            return node.send([ undefined, data ]);
        } 

        // Set basic parameters
        parameters.valueInputOption= "USER_ENTERED";
        parameters.resource = {};
        let fields = (config.selfields[0]) ? Array.from(config.selfields) : undefined;
            
        // If the input is an array
        if (Array.isArray(rows) && rows.length > 0){ 
            if (Array.isArray(rows[0])) parameters.resource.values = rows;
            else if (config.fields === "all") {
                let values = [];
                for (obj of rows){
                    values.push(returnValue(obj, '').values);
                }
                if (method === "new") {
                    if (config.line) values.unshift(returnValue(rows[0], '').keys);
                    if (config.column) {
                        for (let i=0; i<values; i++) elt.unshift(i);
                    }
                }
                parameters.resource.values = values;
            }
            else if (fields) {
                let values = [];
                for (obj of rows){
                    let res = returnValue(obj, '');
                    let row = []; 
                    for (field of fields) {
                        let i = res.keys.indexOf(field);
                        if (i > -1) row.push(res.values[i]);
                    }
                    values.push(row);
                }
                if (method === "new") {
                    if (config.line) values.unshift(fields);
                    if (config.column) {
                        if (config.line) values[0].unshift("Elements")
                        for (let i=1; i<values; i++) values[i].unshift(i-1);
                    }
                }
                parameters.resource.values = values;
            }
        }
        else if (typeof rows === 'object' && rows.length === undefined) {
            if (config.fields === "all") {
                let values = [], labels = [];

                for (obj in rows){
                    let res = returnValue(rows[obj], '');
                    values.push(res.values);
                    labels.push(obj)
                }

                if (config.method === "new") {
                    if (config.line) values.unshift(returnValue(rows[labels[0]], '').keys);
                    if (config.column) {
                        if (config.line) {
                            values[0].unshift("Elements")
                            for (let i=0; i<labels.length; i++) values[i+1].unshift(labels[i]);
                        }
                        else for (let i=0; i<labels.length; i++) values[i].unshift(labels[i]);
                    }
                }
                parameters.resource.values = values;
            }
            else if (fields) {
                let values = [], labels = [];
                for (obj in rows){
                    let res = returnValue(rows[obj], '');
                    let row = []; 
                    for (field of fields) {
                        let i = res.keys.indexOf(field);
                        if (i > -1) row.push(res.values[i]);
                    }
                    values.push(row);
                    labels.push(obj);
                }

                if (method === "new") {
                    if (config.line) values.unshift(fields);
                    if (config.column) {
                        if (config.line) {
                            values[0].unshift("Elements");
                            for (let i=0; i<labels.length; i++) values[i+1].unshift(labels[i]);
                        }
                        else for (let i=0; i<labels.length; i++) values[i].unshift(labels[i]);
                    }
                }
                parameters.resource.values = values;
            }
        }

        method = (method === "new") ? "update" : method;
        sheets.spreadsheets.values[method](parameters, function(err, response) {
            if (err) { 
                node.error(err); 
                return node.send([ undefined, data ]);
            }

            if (!config.output){ return node.send([ data, undefined ]); }

            if (response.updates){ setFromType(config.outputType, config.output || "payload", response); }
            else if (response.values){  
                if (!fields) { setFromType(config.outputType, config.output || "payload", response.values); }
                else {
                    let rows   = response.values
                    let values = []
                    for (row of rows){
                        let obj = {}; values.push(obj);
                        for (let i = 0 ; i < row.length ; i++){
                            helper.setByString(obj, fields[i], row[i])
                        }
                    }
                    setFromType(config.outputType, config.output || "payload", values);
                }
            }
            node.send([ data, undefined ]);
        });
    }

    function queryClear() {

        sheets.spreadsheets.values.clear(parameters, function(err, response) {
            if (err) { 
                node.error(err); 
                return node.send([ undefined, data ]);
            }
            if (action === "clear") {
                setFromType(config.outputType, config.output || "payload", response);
                helper.setByString(saveLoc, saveField, undefined);
                return node.send([ data, undefined ]);
            }
            else return querySet();
        });
    }

    function queryGet() {

        let saveArray = helper.getByString(saveLoc, saveField);
        if (saveArray && saveArray.length > 0) {
            let response = [];
            for (let ob of saveArray) response.push(Array.from(ob));

            if (!config.line && !config.column) {
                setFromType(config.outputType, config.output || "payload", response);
                return node.send([ data, undefined ]);
            }
            if (config.line && config.column) {

                let objet = {};
                let line_labels = response.shift();
                    line_labels.shift();
                let column_labels = [];
                
                for (let obj of response) {
                    let newl = {}; 
                    let item = obj.shift();
                    for (let i=0; i<obj.length;i++) {
                        newl[line_labels[i]] = obj[i];
                    }
                    objet[item] = newl;
                }
                setFromType(config.outputType, config.output || "payload", objet);
                return node.send([ data, undefined ]);
            }
            if ((config.column && config.direction === "column") || 
                (config.line && config.direction === "line")) {
                    let objet = {};
                    for (let obj of response) {
                        objet[obj.shift()] = obj;
                    }

                    setFromType(config.outputType, config.output || "payload", objet);
                    return node.send([ data, undefined ]);
            }
            else {
                let array = [];
                let line_labels = response.shift();

                for (let obj of response) {
                    let newl = {}; 
                    for (let i=0; i<obj.length; i++) {
                        newl[line_labels[i]] = obj[i];
                    }
                    array.push(newl);
                }

                setFromType(config.outputType, config.output || "payload", array);
                return node.send([ data, undefined ]);
            }
        }

        parameters.majorDimension = (config.direction === "column") ? "COLUMNS" : "ROWS";
        sheets.spreadsheets.values.get(parameters, function(err, response) {

            if (err) { 
                node.error(err);
                return node.send([ undefined, data ]);
            }
            if (!response.values) {
                setFromType(config.outputType, config.output || "payload", "");
                return node.send([ data, undefined ]);
            }

            let result = [];
            for (let ob of response.values) result.push(Array.from(ob));
            helper.setByString(saveLoc, saveField, result);

            if (!config.line && !config.column) {
                setFromType(config.outputType, config.output || "payload", response.values);
                return node.send([ data, undefined ]);
            }
            if (config.line && config.column) {

                let objet = {};
                let line_labels = response.values.shift();
                    line_labels.shift();
                let column_labels = [];
                
                for (let obj of response.values) {
                    let newl = {}; 
                    let item = obj.shift();
                    for (let i=0; i<obj.length;i++) {
                        newl[line_labels[i]] = obj[i];
                    }
                    objet[item] = newl;
                }
                setFromType(config.outputType, config.output || "payload", objet);
                return node.send([ data, undefined ]);
            }
            if ((config.column && response.majorDimension === "COLUMNS") || 
                (config.line && response.majorDimension === "ROWS")) {
                    let objet = {};
                    for (let obj of response.values) {
                        objet[obj.shift()] = obj;
                    }

                    setFromType(config.outputType, config.output || "payload", objet);
                    return node.send([ data, undefined ]);
            }
            else {
                let array = [];
                let line_labels = response.values.shift();

                for (let obj of response.values) {
                    let newl = {}; 
                    for (let i=0; i<obj.length; i++) {
                        newl[line_labels[i]] = obj[i];
                    }
                    array.push(newl);
                }

                setFromType(config.outputType, config.output || "payload", array);
                return node.send([ data, undefined ]);
            }
        });
    }

    function queryCell() {
        let cell_l = config.cell_l,
            cell_c = config.cell_c;

        if (config.cell_lType !== 'str') {
            cell_l = getFromType(config.cell_lType, loc, cell_l);
        }
        if (config.cell_cType !== 'str') {
            cell_c = getFromType(config.cell_cType, loc, cell_c);
        }

        if (!cell_l || !cell_c) {
            node.error("Cannot find line and column labels")
            return node.send([ undefined, data ]);
        }

        let saveArray = helper.getByString(saveLoc, saveField);
        if (saveArray && saveArray.length > 0) {
            let response = [];
            for (let ob of saveArray) response.push(Array.from(ob));
            let column_labels = response.shift();
                column_labels.shift();
            let line_labels = [];
            
            for (let obj of response) {
                line_labels.push(obj.shift());
            }

            let c = column_labels.indexOf(cell_c),
                l = line_labels.indexOf(cell_l);

            if (c === -1 || l === -1 || !response[l][c]) setFromType(config.outputType, config.output || "payload", "Not found");
            else setFromType(config.outputType, config.output || "payload", response[l][c]);
            return node.send([ data, undefined ]);
        }

        sheets.spreadsheets.values.get(parameters, function(err, response) {
            if (err) { 
                node.error(err);
                return node.send([ undefined, data ]);
            }

            if (!response.values) {
                setFromType(config.outputType, config.output || "payload", "");
                return node.send([ data, undefined ]);
            }

            let result = []; saved = [];
            for (let ob of response.values) {
                result.push(Array.from(ob));
                saved.push(Array.from(ob));
            }
            helper.setByString(saveLoc, saveField, saved);


            let column_labels = result.shift();
                column_labels.shift();
            let line_labels = [];
            
            for (let obj of result) {
                line_labels.push(obj.shift());
            }

            let c = column_labels.indexOf(cell_c),
                l = line_labels.indexOf(cell_l);

            if (c === -1 || l === -1 || !result[l][c]) setFromType(config.outputType, config.output || "payload", "Not found");

            else setFromType(config.outputType, config.output || "payload", result[l][c]);
            return node.send([ data, undefined ]);
        });
    }
    function returnValue(obj, chaine) {
        let keys = [], values = [];
        for (let i in obj) {
            if (typeof obj[i] === "object" && obj[i].length === undefined) {
                let res = returnValue(obj[i], chaine + '.' + i);
                keys = keys.concat(res.keys);
                values = values.concat(res.values);
            }
            else {
                keys.push((chaine + '.' + i).substring(1));
                values.push(obj[i]);
            }
        }
        return { keys: keys, values: values} ;
    }

    try {
        node.auth.authenticate((auth) => {
            parameters.auth = auth;

            if      (action === "clear" || (action === "set" && config.method === "new")) return queryClear();
            else if (action === "get") return queryGet();
            else if (action === "set") return querySet(); 
            else if (action === "cell") return queryCell(); 
        })
    } catch (ex){ 
        console.log(ex); 
        node.send([ undefined, data ]);
    }
}
