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

import assert from 'assert';

import AppHelper from '../src/lib/helpers/AppHelper';
import {
  adminAddAccountPermission,
  adminAddGroupPermission,
  adminCreateAccount,
  adminCreateGroup,
  adminCreateGroupAccount,
  adminEditAccount,
  adminGetAccount
} from '../src/lib/helpers/AdminHelper';
import accountsJson from './accounts';
import groupsJson from './groups';
import { getAuthorizedKeys, getAuthorizedKeysAsJson } from '../src/lib/helpers/KeysHelper';
import DbHelper, { releaseDHInstance } from '../src/lib/helpers/DbHelper';

const settings = {
  admin: {
    token: ''
  },
  client: {
    tokens: []
  },
  db: {
    engine: 'sqlite',
    storage: ':memory:'
  },
  server: {
    http_port: 9100
  }
};

const dh = DbHelper(settings.db);
const dm = dh.getManager();
if (!dm) {
  console.error('Unable to load DB Manager!!!');
  process.exit(99);
}

const loadDb = async function() {
  return new Promise((resolve, reject) => {
    dm.getClient(false, function(db) {
      dh.init(db)
        .then(() => {
          resolve(db);
        })
        .catch(e => reject(e));
    });
  });
};

const loadData = async function(db) {
  for (let i = 0; i < accountsJson.length; i++) {
    const account = await adminCreateAccount(db, accountsJson[i]);
    for (let ii = 0; ii < accountsJson[i].permissions.length; ii++) {
      await adminAddAccountPermission(
        db,
        account.id,
        accountsJson[i].permissions[ii].user,
        accountsJson[i].permissions[ii].host,
        accountsJson[i].permissions[ii].ssh_options
      );
    }
  }
  for (let i = 0; i < groupsJson.length; i++) {
    const group = await adminCreateGroup(db, { name: groupsJson[i].name });
    for (let ii = 0; ii < groupsJson[i].permissions.length; ii++) {
      const { user, host, ssh_options } = groupsJson[i].permissions[ii];
      await adminAddGroupPermission(db, group.id, user, host, ssh_options);
    }
    for (let ii = 0; ii < groupsJson[i].accounts.length; ii++) {
      const account = await adminGetAccount(db, groupsJson[i].accounts[ii].email);
      await adminCreateGroupAccount(db, group.id, account.id);
    }
  }
};

describe('Check keys', function() {
  this.timeout(10000);
  let db;
  before(async function() {
    const ah = AppHelper(settings);
    try {
      db = await loadDb(ah);
    } catch (err) {
      console.error(err);
    }
  });

  after(function(done) {
    releaseDHInstance()
      .then(done)
      .catch(e => done(e));
  });

  describe('check accounts creation', function() {
    before(async function() {
      await loadData(db);
    });
    it('should return an account object with right number of keys and permissions', async function() {
      const resAccount = await adminGetAccount(db, 1);
      assert.strictEqual(resAccount.permissions.length, 5);
      assert.strictEqual(resAccount.public_keys.length, 5);
    });
  });

  describe('check authorized_keys for user=mil and host=mil', function() {
    it('should return 14 rows', async function() {
      const { keys: res } = await getAuthorizedKeys(dm, 'mil', 'mil');
      assert.strictEqual(res.split('\n').length, 14);
    });
  });

  describe('check authorized_keys for user=biz and host=com', function() {
    it('should return 13 rows', async function() {
      const { keys: res } = await getAuthorizedKeys(dm, 'biz', 'com');
      assert.strictEqual(res.split('\n').length, 13);
    });
  });

  describe('check authorized_keys for user=unkown and host=unkown', function() {
    it('should return 1 rows (only Jolly user 3)', async function() {
      const { keys: res } = await getAuthorizedKeys(dm, 'unkown', 'unkown');
      assert.strictEqual(res.split('\n').length, 1);
    });
  });

  describe('check authorized_keys for user=name and host=edu', function() {
    it('should return 10 rows per 4 users (5 + 2 + 2 + 1)', async function() {
      const { keys: res } = await getAuthorizedKeys(dm, 'name', 'edu');
      assert.strictEqual(res.split('\n').length, 10);
    });
  });

  describe('check authorized_keys for user=root and host=xxx', function() {
    it('should return 5 rows per 2 user (2 + 2 + 1) 4 of them with options', async function() {
      const res = await getAuthorizedKeysAsJson(dm, 'root', 'xxx');
      assert.strictEqual(res.keys.length, 5);
      res.keys.forEach(k => {
        if (k.email === 'jolly3@newsvine.com') {
          assert.strictEqual(k.ssh_options, '');
        } else if (k.email === 'klocal1@ezinearticles.com') {
          assert.strictEqual(k.ssh_options, 'from="192.168.1.1"');
        } else {
          assert.strictEqual(k.ssh_options, 'from="192.168.1.1"');
        }
      });
    });
  });

  describe('check authorized_keys for user=xxx and host=xxx', function() {
    it('should return 3 rows per 2 user (2 + 1) 2 of them with options', async function() {
      const res = await getAuthorizedKeysAsJson(dm, 'xxx', 'xxx');
      assert.strictEqual(res.keys.length, 3);
      res.keys.forEach(k => {
        if (k.email === 'jolly3@newsvine.com') {
          assert.strictEqual(k.ssh_options, '');
        } else if (k.email === 'klocal1@ezinearticles.com') {
          assert.strictEqual(k.ssh_options, 'from="192.168.2.1,192.168.3.1"');
        }
      });
    });
  });

  describe('check authorized_keys for user=name and host=edu after account expired', function() {
    it('should return 10 rows per 4 users (5 + 2 + 1)', async function() {
      const now = new Date().getTime();
      await adminEditAccount(db, 'scallar1b@1und1.de', undefined, now - 60000);
      const { keys: res } = await getAuthorizedKeys(dm, 'name', 'edu');
      assert.strictEqual(res.split('\n').length, 8);
    });
  });

  describe('check authorized_keys for user=ansibleusr and host=testansible', function() {
    it('should return 3 rows per 3 users (1 + 1 + 1) with correct ssh_options', async function() {
      const { keys: res } = await getAuthorizedKeysAsJson(dm, 'ansibleusr', 'testansible');
      assert.strictEqual(res.length, 3);
      assert.strictEqual(res[0].ssh_options, 'command="ansible"');
      assert.strictEqual(res[1].ssh_options, '');
      assert.strictEqual(res[2].ssh_options, 'from="192.168.3.1",restrict');
    });

    it('should return 3 rows per 3 users (1 + 1 + 1) with correct ssh_options', async function() {
      const { keys } = await getAuthorizedKeys(dm, 'ansibleusr', 'testansible');
      const res = keys.split('\n');
      assert.strictEqual(res.length, 3);
      assert.strictEqual(res[0].indexOf('command="ansible" '), 0);
      assert.strictEqual(res[1].indexOf('ssh'), 0);
      assert.strictEqual(res[2].indexOf('from="192.168.3.1",restrict '), 0);
    });
  });

  describe('check authorized_keys for user=ansibleusr and host=testansible2', function() {
    it('should return 3 rows per 3 users (1 + 1 + 1) with correct ssh_options', async function() {
      const { keys: res } = await getAuthorizedKeysAsJson(dm, 'ansibleusr', 'testansible2');
      assert.strictEqual(res.length, 4);
      assert.strictEqual(res[0].ssh_options, 'command="ansible"');
      assert.strictEqual(res[1].ssh_options, '');
      assert.strictEqual(res[2].ssh_options, '');
      assert.strictEqual(res[3].ssh_options, 'from="192.168.3.1",restrict');
    });

    it('should return 3 rows per 3 users (1 + 1 + 1) with correct ssh_options', async function() {
      const { keys } = await getAuthorizedKeys(dm, 'ansibleusr', 'testansible2');
      const res = keys.split('\n');
      assert.strictEqual(res.length, 4);
      assert.strictEqual(res[0].indexOf('command="ansible" '), 0, 'index 0');
      assert.strictEqual(res[1].indexOf('ssh'), 0, 'index 1');
      assert.strictEqual(res[2].indexOf('ssh'), 0, 'index 2');
      assert.strictEqual(res[3].indexOf('from="192.168.3.1",restrict '), 0, 'index 3');
    });
  });
});
