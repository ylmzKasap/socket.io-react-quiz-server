const ROOM_TTL = 3 * 60 * 60;

class RedisRoomStore {
  constructor(redisClient) {
    this.redisClient = redisClient;
  }

  async findRoom(id) {
    let answers = []
    let room = await this.redisClient.hGetAll(`room:${id}`);

    if (Object.keys(room).length !== 0) {
      answers = await this.redisClient.lRange(`room:${id}:answers`, 0, -1);
    }
    
    return Object.keys(room).length === 0 
    ? undefined 
    : {...room, answers: answers}
  }

  async deleteRoom(id) {
    this.redisClient.del(`room:${id}:answers`)
    return this.redisClient.del(`room:${id}`)
  }

  async setRoundStarted(id, roundStarted) {
    return this.redisClient.hSet(`room:${id}`, {roundStarted: `${roundStarted}`});
  }

  async setRoundEnded(id, roundEnded) {
    return this.redisClient.hSet(`room:${id}`, {roundEnded: `${roundEnded}`});
  }

  async addAnswer(id, answer) {
    return this.redisClient.rPush(`room:${id}:answers`, JSON.stringify(answer))
  }

  async findRoomByPin(pin) {
    let room;
    let answers = [];
    for await (const key of this.redisClient.scanIterator({
      MATCH: 'room:*',
    })) {
      if (key.endsWith(':answers')) continue;
      const value = await this.redisClient.hGetAll(key)
      if (value.room_pin === pin) {
        room = ({...value, room_id: key.split('room:')[1]})
        break
      }
    }

    if (room) {
      answers = await this.redisClient.lRange(`room:${room.room_id}:answers`, 0, -1);
    }

    return room ? {...room, answers: answers} : undefined
  }

  async restartRound(id) {
    await this.redisClient
      .multi()
      .hSet(`room:${id}`, {roundEnded: 'false', roundStarted: 'false'})
      .expire(`room:${id}`, ROOM_TTL)
      .expire(`room:${id}:answers`, ROOM_TTL)
      .exec();

    return this.redisClient.del(`room:${id}:answers`)
  }

  async saveRoom(id, pin, questions) {
    this.redisClient
      .multi()
      .hSet(`room:${id}`, {
        room_pin: pin, questions: JSON.stringify(questions), roundStarted: 'false', roundEnded: 'false'}
      )
      .expire(`room:${id}`, ROOM_TTL)
      .expire(`room:${id}:answers`, ROOM_TTL)
      .exec();
  }
}

/* interface Room {
  [key: string] {
    host_id: string;
    room_pin: number;
    questions: {
      deck_id: string;
      image_path: string;
      question_id: string;
      sound_path: string;
      source_translation: string;
      target_translation: string;
      word_order: number
    }
    answers: {
      question_id: string;
      user_id: string;
      isCorrect: Boolean;
    }[];
  }
} */ 

module.exports = {
  RedisRoomStore
};
