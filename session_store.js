const SESSION_TTL = 6 * 60 * 60;

class RedisSessionStore {
  constructor(redisClient) {
    this.redisClient = redisClient;
  }

  async findSession(id) {
    const session = await this.redisClient.hGetAll(`session:${id}`)
    return Object.keys(session).length === 0
      ? undefined
      : session;
  }

  async setConnected(id, connected) {
    await this.redisClient.hSet(`session:${id}`, {connected: connected})
    if (connected === 'true') {
      return this.redisClient.expire(`session:${id}`, SESSION_TTL)
    }
  }

  setUsername(id, username) {
    return this.redisClient.hSet(`session:${id}`, {username: username})
  }

  setJoinedRoomID(id, joined_room_id) {
    return this.redisClient.hSet(`session:${id}`, {joined_room_id: joined_room_id})
  }

  setJoinedRoomAndUsername(id, joined_room_id, username) {
    return this.redisClient.hSet(`session:${id}`, {username: username, joined_room_id: joined_room_id});
  }

  async saveSession(id, userID) {
    this.redisClient
      .multi()
      .hSet(`session:${id}`, {userID: userID, connected: "true"})
      .expire(`session:${id}`, SESSION_TTL)
      .exec();
  }

  async findAllSessions() {
    let allSessions = []
    for await (const key of this.redisClient.scanIterator({
      MATCH: 'session:*',
    })) {
      const value = await this.redisClient.hGetAll(key)
      allSessions.push({...value, sessionID: key.split('session:')[1]})
    }
    return allSessions;
  }
}

/* 
class User {
  userID: string;
  username: string;
  connected: boolean;
  joined_room_id: string;
}
*/

module.exports = {
  RedisSessionStore
};
