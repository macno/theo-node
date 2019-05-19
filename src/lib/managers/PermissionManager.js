import AccountManager from './AccountManager';
import GroupManager from './GroupManager';

class PermissionManager {
  constructor(db, am, gm) {
    this.db = db;
    if (am) {
      this.am = am;
    } else {
      this.am = new AccountManager(this.db);
    }
    if (gm) {
      this.gm = gm;
    } else {
      this.gm = new GroupManager(this.db);
    }
  }

  static _getMatchSqlWhere() {
    return (
      'where ? like p.host and ? like p.user ' +
      'and k.account_id = a.id ' +
      'and g.id = p.group_id ' +
      'and g.id = ga.group_id ' +
      'and a.id = ga.account_id ' +
      'and a.active = 1 ' +
      'and g.active = 1 ' +
      'and (a.expire_at = 0 or a.expire_at > ?) '
    );
  }

  match(user, host) {
    const sql =
      'select distinct k.public_key, k.public_key_sig, k.fingerprint, a.email ' +
      ' from accounts a, public_keys k, tgroups g, groups_accounts ga, permissions p ' +
      PermissionManager._getMatchSqlWhere();
    const now = new Date().getTime();
    return this.db.all(sql, [host, user, now]);
  }

  search(user, host) {
    const sql =
      'select distinct a.id, a.email, p.host, p.user ' +
      ' from accounts a, public_keys k, tgroups g, groups_accounts ga, permissions p ' +
      PermissionManager._getMatchSqlWhere();
    const now = new Date().getTime();
    return this.db.all(sql, [host, user, now]);
  }

  async match_old(user, host) {
    const fromPermissions = 'select account_id, group_id from permissions where ? like host and ? like user';
    const permissions = await this.db.all(fromPermissions, [host, user]);
    const accountCache = {};
    return Promise.all(
      permissions.map(async permission => {
        const { account_id, group_id } = permission;
        if (account_id) {
          if (!accountCache[account_id]) {
            accountCache[account_id] = true;
            return this.am.getKeysIfActive(account_id);
          }
          return [];
        }

        // group permissions..
        const accounts = await this.gm.getAccountsIfActive(group_id);
        return Promise.all(
          accounts.map(async account => {
            const account_id = account.account_id;
            if (!accountCache[account_id]) {
              accountCache[account_id] = true;
              return this.am.getKeysIfActive(account_id);
            }
          })
        ).then(keys => {
          return [].concat.apply([], keys);
        });
      })
    ).then(keys => [].concat.apply([], keys));
  }

  getAll(account_id, limit, offset) {
    let sql = 'select id, user, host, created_at from permissions where account_id = ? order by created_at ';
    if (limit) {
      sql += ' limit ' + limit;
    }
    if (offset) {
      sql += ' offset ' + offset;
    }
    return this.db.all(sql, [account_id]);
  }

  getAllGroup(group_id, limit, offset) {
    let sql = 'select id, user, host, created_at from permissions where group_id = ? order by created_at ';
    if (limit) {
      sql += ' limit ' + limit;
    }
    if (offset) {
      sql += ' offset ' + offset;
    }
    return this.db.all(sql, [group_id]);
  }

  async create(group_id, user, host) {
    const sql = 'insert into permissions (group_id, user, host, created_at) values (?, ?, ?, ?) ';
    const lastId = await this.db.insert(sql, [group_id, user, host, new Date().getTime()]);
    await this.gm.setUpdatedAt(group_id);
    return lastId;
  }

  async get(group_id, id) {
    const sql = 'select host, user from permissions where id = ? and group_id = ?';
    return this.db.get(sql, [id, group_id]);
  }

  async delete(group_id, id) {
    const sql = 'delete from permissions where id = ? and group_id = ?';
    const changes = await this.db.delete(sql, [id, group_id]);
    await this.gm.setUpdatedAt(group_id);
    return changes;
  }
}

export default PermissionManager;
