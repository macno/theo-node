// Copyright 2019 AuthKeys srl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Microservice from '@authkeys/microservice';
import { initRoutes } from './routes';
import packageJson from '../package.json';
import { authMiddleware } from './lib/middlewares/AuthMiddleware';
import { auditMiddleware } from './lib/middlewares/AuditMiddleware';
import { common_error } from './lib/utils/logUtils';
import UpdateHelper from './lib/helpers/UpdateHelper';

const noDbUrls = [{ path: '/authorized_keys', partial: true }, { path: '/' }, { path: '/uptime' }];

let last_check = 0;

const CHECK_INTERVAL = 60 * 60 * 24 * 7 * 1000;

const doURLneedDb = function(path) {
  for (let i = 0; i < noDbUrls.length; i++) {
    if (noDbUrls[i].partial) {
      if (path.indexOf(noDbUrls[i].path) === 0) {
        return false;
      }
    } else {
      if (path === noDbUrls[i]) {
        return false;
      }
    }
  }
  return true;
};

class TheoServer extends Microservice {
  dm;

  constructor(environment, dm) {
    super(environment);
    this.dm = dm;
    this.skip_updatecheck = this.envBool(process.env, 'SKIP_UPDATECHECK', false);
    if (!this.skip_updatecheck) {
      last_check = Date.now();
      UpdateHelper.checkUpdate();
    }
  }

  setupRoutes(app, express) {
    app.disable('x-powered-by');
    app.use(authMiddleware);
    app.use(auditMiddleware);
    app.use(async (req, res, next) => {
      const { path, method } = req;
      res.set('Connection', 'close');
      req.dm = this.dm;
      if (method !== 'HEAD') {
        const needDb = doURLneedDb(path);
        if (needDb) {
          const client = this.dm.getClient(method === 'GET' ? 'ro' : 'rw');
          try {
            await client.open();
          } catch (err) {
            console.error(err);
            // Ops..
            res.status(500);
            res.json({ status: 500, reason: 'A problem occurred, please retry' });
            return;
          }
          req.db = client;
          res.on('finish', () => {
            try {
              client.close();
            } catch (e) {
              common_error('db close', e.message);
            }
          });
        } else {
          res.on('finish', () => {
            if (this.skip_updatecheck) {
              return;
            }
            if (Date.now() - last_check > CHECK_INTERVAL) {
              last_check = Date.now();
              UpdateHelper.checkUpdate(err => {
                if (err) {
                  console.error(err.message);
                }
              });
            }
          });
        }
      }
      next();
    });
    app.use('/', initRoutes(express));
  }

  getName() {
    return packageJson.name;
  }

  getVersion() {
    return packageJson.version;
  }
}

export default TheoServer;
