import GroupManager from '../../managers/GroupManager';
import EventHelper from '../EventHelper';
import AuditHelper from '../AuditHelper';

export const adminCreateGroup = async (db, group, auth_token, onlyId = false) => {
  if (!group.name) {
    const error = new Error('Malformed object, name is required');
    error.t_code = 400;
    throw error;
  }
  const gm = new GroupManager(db);
  const check = await gm.checkName(group.name);
  if (check) {
    const error = new Error('Group already exists');
    error.t_code = 409;
    throw error;
  }
  try {
    const id = await gm.create(group.name);
    EventHelper.emit('theo:change', {
      func: 'group',
      action: 'add',
      object: id,
      receiver: 'admin'
    });
    AuditHelper.log(auth_token, 'groups', 'create', group.name);
    if (onlyId) return id;
    return gm.getFull(id);
  } catch (err) {
    err.t_code = 500;
    throw err;
  }
};

export const adminGetGroup = async (db, id) => {
  const gm = new GroupManager(db);
  try {
    if (isNaN(id)) {
      id = await gm.getIdByName(id);
    }
    return gm.getFull(id);
  } catch (err) {
    if (!err.t_code) err.t_code = 500;
    throw err;
  }
};

export const adminEditGroup = async (db, group_id, active, auth_token) => {
  const gm = new GroupManager(db);
  let group;
  try {
    if (isNaN(group_id)) {
      group = await gm.getByName(group_id);
      group_id = group.id;
    } else {
      group = await gm.get(group_id);
    }
    if (!group) {
      const error = new Error('Group not found');
      error.t_code = 404;
      throw error;
    }
    if (!!group.active === active) {
      return false;
    }
    await gm.changeStatus(group_id, active);
    AuditHelper.log(auth_token, 'groups', 'edit', group.name, { active: { prev: group.active, next: active } });
    return true;
  } catch (err) {
    if (!err.t_code) err.t_code = 500;
    throw err;
  }
};

export const adminDeleteGroup = async (db, group_id, auth_token) => {
  const gm = new GroupManager(db);
  let group;
  try {
    if (isNaN(group_id)) {
      group = await gm.getByName(group_id);
      group_id = group.id;
    } else {
      group = await gm.get(group_id);
    }
    if (!group) {
      const error = new Error('Group not found');
      error.t_code = 404;
      throw error;
    }
    await gm.delete(group_id);
    AuditHelper.log(auth_token, 'groups', 'delete', group.name);
    return true;
  } catch (err) {
    if (!err.t_code) err.t_code = 500;
    throw err;
  }
};