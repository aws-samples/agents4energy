"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageBrowser = void 0;
var ui_react_1 = require("@aws-amplify/ui-react");
var storage_1 = require("@aws-amplify/ui-react-storage");
require("@aws-amplify/ui-react-storage/styles.css");
//   import config from '../../../amplify_outputs.json';
//   Amplify.configure(config);
exports.StorageBrowser = (0, storage_1.createStorageBrowser)({
    config: (0, storage_1.createAmplifyAuthAdapter)(),
}).StorageBrowser;
var Page = function () { return (<ui_react_1.Authenticator>
    <exports.StorageBrowser />
  </ui_react_1.Authenticator>); };
exports.default = Page;
