/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-38bb0eb2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();

  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "sw-cleanup.js",
    "revision": "336878c03f06de30b61ae7e439a3f3ff"
  }, {
    "url": "simple.html",
    "revision": "214607453e697137ccbb06c99bc039e9"
  }, {
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "pwa-512x512.png",
    "revision": "5b890e82250fb2d79fbf63fceac6b929"
  }, {
    "url": "pwa-192x192.png",
    "revision": "02907c2ac3872d16a3e206e83fddf2e5"
  }, {
    "url": "offline.html",
    "revision": "3214ea103f668b854eabf967c7d4fac5"
  }, {
    "url": "index.html",
    "revision": "b85d37887a396a90fae2e95c0a886ca6"
  }, {
    "url": "favicon.png",
    "revision": "54644338529c047ee6ed51e897f9c6ce"
  }, {
    "url": "favicon-dark.png",
    "revision": "745cb20daabf1099a558b5fa32e184b5"
  }, {
    "url": "dev-error-suppression.js",
    "revision": "d6be241ea135f8c9d6b9ffe37766535b"
  }, {
    "url": "assets/xychartDiagram-PRI3JC2R-DJ1Ue4gP.js",
    "revision": null
  }, {
    "url": "assets/xlsx-BqVoTnzm.js",
    "revision": null
  }, {
    "url": "assets/workspace-settings-CVuDGgPe.js",
    "revision": null
  }, {
    "url": "assets/workspace-DJmZwNrC.js",
    "revision": null
  }, {
    "url": "assets/vendor-ui-CkVm7n3d.js",
    "revision": null
  }, {
    "url": "assets/vendor-react-CkBspc2p.js",
    "revision": null
  }, {
    "url": "assets/use-cloud-library-I1W4Sq6E.js",
    "revision": null
  }, {
    "url": "assets/use-chat-folders-DDtRxOLp.css",
    "revision": null
  }, {
    "url": "assets/use-chat-folders-BWH6bpeF.js",
    "revision": null
  }, {
    "url": "assets/treemap-KMMF4GRG-DBqsw-jw.js",
    "revision": null
  }, {
    "url": "assets/timeline-definition-IT6M3QCI-BvkJ-rwa.js",
    "revision": null
  }, {
    "url": "assets/textarea-Q2e2k3P9.js",
    "revision": null
  }, {
    "url": "assets/terms-BiK8nQp3.js",
    "revision": null
  }, {
    "url": "assets/tabs-Cjw1BrQo.js",
    "revision": null
  }, {
    "url": "assets/switch-BVPQMV9b.js",
    "revision": null
  }, {
    "url": "assets/stateDiagram-v2-4FDKWEC3-Cj6lLERK.js",
    "revision": null
  }, {
    "url": "assets/stateDiagram-FKZM4ZOC-BtmrU1T5.js",
    "revision": null
  }, {
    "url": "assets/spreadsheet-editor-BXZepZDB.js",
    "revision": null
  }, {
    "url": "assets/skills-M137beLD.js",
    "revision": null
  }, {
    "url": "assets/sira-logo-JJJU0LC0.png",
    "revision": null
  }, {
    "url": "assets/signup-DQKSdyJf.js",
    "revision": null
  }, {
    "url": "assets/share-icon-C4p42T6V.png",
    "revision": null
  }, {
    "url": "assets/settings-Cmsjrhj8.js",
    "revision": null
  }, {
    "url": "assets/sequenceDiagram-WL72ISMW-DTTKWBS9.js",
    "revision": null
  }, {
    "url": "assets/separator-CEClYziq.js",
    "revision": null
  }, {
    "url": "assets/select-y_KEy9OP.js",
    "revision": null
  }, {
    "url": "assets/sankeyDiagram-TZEHDZUN-B2GhT0DV.js",
    "revision": null
  }, {
    "url": "assets/requirementDiagram-UZGBJVZJ-BBjleu5p.js",
    "revision": null
  }, {
    "url": "assets/quadrantDiagram-AYHSOK5B-BGnoaDXH.js",
    "revision": null
  }, {
    "url": "assets/progress-Ciu5Tc1L.js",
    "revision": null
  }, {
    "url": "assets/profile-DrtIy4o1.js",
    "revision": null
  }, {
    "url": "assets/privacy-policy-B7vqeo_x.js",
    "revision": null
  }, {
    "url": "assets/privacy-BUIhWCyx.js",
    "revision": null
  }, {
    "url": "assets/prismWorker-Dk4OiJfT.js",
    "revision": null
  }, {
    "url": "assets/pricing-D_jVw0b6.js",
    "revision": null
  }, {
    "url": "assets/pptPostProcessor-CKN8FPow.js",
    "revision": null
  }, {
    "url": "assets/power-C7AAfSPu.js",
    "revision": null
  }, {
    "url": "assets/popover-DR8jIdN9.js",
    "revision": null
  }, {
    "url": "assets/pieDiagram-ADFJNKIX-BUWd__0Z.js",
    "revision": null
  }, {
    "url": "assets/not-found-1c7lwhEj.js",
    "revision": null
  }, {
    "url": "assets/mindmap-definition-VGOIOE7T-CoiBhfK4.js",
    "revision": null
  }, {
    "url": "assets/mermaid-core-Ia749xx_.js",
    "revision": null
  }, {
    "url": "assets/memory-Bucv2EwI.js",
    "revision": null
  }, {
    "url": "assets/login-approve-BxwAkZyv.js",
    "revision": null
  }, {
    "url": "assets/login-XcQE6SIC.js",
    "revision": null
  }, {
    "url": "assets/learn-C9TjLtxY.js",
    "revision": null
  }, {
    "url": "assets/layout-CuLnLx33.js",
    "revision": null
  }, {
    "url": "assets/landing-I281iZF1.js",
    "revision": null
  }, {
    "url": "assets/label-DlypZT9y.js",
    "revision": null
  }, {
    "url": "assets/kanban-definition-3W4ZIXB7-B3HOmlZk.js",
    "revision": null
  }, {
    "url": "assets/journeyDiagram-XKPGCS4Q-DFrRthAu.js",
    "revision": null
  }, {
    "url": "assets/infoDiagram-WHAUD3N6-FGijrcRz.js",
    "revision": null
  }, {
    "url": "assets/index-qLmNgu3a.css",
    "revision": null
  }, {
    "url": "assets/index-Ugmb45SF.js",
    "revision": null
  }, {
    "url": "assets/index-DqZaNW1W.js",
    "revision": null
  }, {
    "url": "assets/index-DS3l3205.js",
    "revision": null
  }, {
    "url": "assets/index-C7yKKq-w.js",
    "revision": null
  }, {
    "url": "assets/index-Bwge4rAS.js",
    "revision": null
  }, {
    "url": "assets/iliagpt-logo-gjC_v4B6.js",
    "revision": null
  }, {
    "url": "assets/home-Dpn-HDUz.js",
    "revision": null
  }, {
    "url": "assets/graph-B2AAXh1J.js",
    "revision": null
  }, {
    "url": "assets/gitGraphDiagram-NY62KEGX-C0l-bdn5.js",
    "revision": null
  }, {
    "url": "assets/ganttDiagram-JELNMOA3-D8FtTrDM.js",
    "revision": null
  }, {
    "url": "assets/formula-engine.worker-BBgzpmDX.js",
    "revision": null
  }, {
    "url": "assets/flowDiagram-NV44I4VS-CeTpFCYm.js",
    "revision": null
  }, {
    "url": "assets/erDiagram-Q2GNP2WA-BWFP5XwF.js",
    "revision": null
  }, {
    "url": "assets/dropdown-menu-G1TXmisl.js",
    "revision": null
  }, {
    "url": "assets/download-CU4tFO35.js",
    "revision": null
  }, {
    "url": "assets/diagram-S2PKOQOG-Nb_efc0p.js",
    "revision": null
  }, {
    "url": "assets/diagram-QEK2KX5R-Do-Bkgyb.js",
    "revision": null
  }, {
    "url": "assets/diagram-PSM6KHXK-Cqd0hLzu.js",
    "revision": null
  }, {
    "url": "assets/dagre-6UL2VRFP-BouPyqRy.js",
    "revision": null
  }, {
    "url": "assets/cytoscape-BnkdMOzK.js",
    "revision": null
  }, {
    "url": "assets/cose-bilkent-S5V4N54A-Cunt0ZmW.js",
    "revision": null
  }, {
    "url": "assets/collapsible-DVUoeLAk.js",
    "revision": null
  }, {
    "url": "assets/clone-9ajI7hxs.js",
    "revision": null
  }, {
    "url": "assets/classDiagram-v2-WZHVMYZB-CIol7XM0.js",
    "revision": null
  }, {
    "url": "assets/classDiagram-2ON5EDUG-CIol7XM0.js",
    "revision": null
  }, {
    "url": "assets/chunk-TZMSLE5B-DbEECBjF.js",
    "revision": null
  }, {
    "url": "assets/chunk-QZHKN3VN-BnX4SKL6.js",
    "revision": null
  }, {
    "url": "assets/chunk-QN33PNHL-DFGfnTcl.js",
    "revision": null
  }, {
    "url": "assets/chunk-FMBD7UC4-sJNVcU3S.js",
    "revision": null
  }, {
    "url": "assets/chunk-DI55MBZ5-6fqdvrhS.js",
    "revision": null
  }, {
    "url": "assets/chunk-B4BG7PRW-4MQP88wE.js",
    "revision": null
  }, {
    "url": "assets/chunk-55IACEB6-KD6RpSXK.js",
    "revision": null
  }, {
    "url": "assets/chunk-4BX2VUAB-DSiIRrpF.js",
    "revision": null
  }, {
    "url": "assets/checkbox-C1bKfbMM.js",
    "revision": null
  }, {
    "url": "assets/c4Diagram-YG6GDRKO-CL2shzR7.js",
    "revision": null
  }, {
    "url": "assets/business-lyuuqJ-d.js",
    "revision": null
  }, {
    "url": "assets/blockDiagram-VD42YOAC-COu12mUT.js",
    "revision": null
  }, {
    "url": "assets/billing-DR9aIh-A.js",
    "revision": null
  }, {
    "url": "assets/avatar-bFQqkGyp.js",
    "revision": null
  }, {
    "url": "assets/architectureDiagram-VXUJARFQ-phVtpNYm.js",
    "revision": null
  }, {
    "url": "assets/alert-dialog-BnM_H69T.js",
    "revision": null
  }, {
    "url": "assets/admin-DKcCC-EZ.css",
    "revision": null
  }, {
    "url": "assets/admin-BwUu01PQ.js",
    "revision": null
  }, {
    "url": "assets/about-DU1_URdd.js",
    "revision": null
  }, {
    "url": "assets/_baseUniq-BLRFf1yD.js",
    "revision": null
  }, {
    "url": "assets/_basePickBy-CAgaJLcS.js",
    "revision": null
  }, {
    "url": "assets/SystemHealth-BedO_1fZ.js",
    "revision": null
  }, {
    "url": "assets/SpreadsheetAnalyzer-MfTY0urt.js",
    "revision": null
  }, {
    "url": "assets/PPTEditorShell-5FxqSy-m.js",
    "revision": null
  }, {
    "url": "assets/OfficeToolShell-CN9dE1hB.js",
    "revision": null
  }, {
    "url": "assets/MonitoringDashboard-D987Vt1i.js",
    "revision": null
  }, {
    "url": "assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Size2-Regular-Dy4dx90m.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Size1-Regular-mCD8mA8B.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Script-Regular-D3wIWfF6.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Math-Italic-t53AETM-.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Main-Regular-B22Nviop.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Main-Italic-NWA7e6Wa.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Main-Bold-Cx986IdX.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2",
    "revision": null
  }, {
    "url": "assets/KaTeX_AMS-Regular-BQhdFMY1.woff2",
    "revision": null
  }, {
    "url": "assets/AreaChart-DXPY99v_.js",
    "revision": null
  }, {
    "url": "pwa-192x192.png",
    "revision": "02907c2ac3872d16a3e206e83fddf2e5"
  }, {
    "url": "pwa-512x512.png",
    "revision": "5b890e82250fb2d79fbf63fceac6b929"
  }, {
    "url": "manifest.webmanifest",
    "revision": "3810032c4ee0da93f9ffaf84ae9b93c4"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//]
  }));
  workbox.registerRoute(/^\/api\//, new workbox.NetworkOnly(), 'GET');
  self.__WB_DISABLE_DEV_LOGS = true;

}));
