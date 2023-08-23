/* abstract */ class RoomStore {
  findRoom(id) {}
  findRoomByPin(pin) {}
  saveRoom(id, room) {}
  deleteRoom(id) {}
  addAnswer(room_id, answer) {}
  findAllRooms() {}
}

class InMemoryRoomStore extends RoomStore {
  constructor() {
    super();
    this.rooms = new Map();
  }

  findRoom(id) {
    return this.rooms.get(id);
  }

  findRoomByPin(pin) {
    let room;
    for (let [id, roomObj] of this.rooms.entries()) {
      if (roomObj.room_pin == pin) {
        room = {
          ...roomObj,
          room_id: id
        }
        break;
      }
    }
    return room;
  }

  addAnswer(room_id, answer) {
    const room = this.rooms.get(room_id);
    this.rooms.set(room_id, {
      ...room,
      answers: [...room.answers, answer]
    })
  }

  saveRoom(id, room) {
    this.rooms.set(id, room);
  }

  deleteRoom(host_id) {
    this.rooms.delete(host_id);
  }

  findAllRooms() {
    return [...this.rooms.values()];
  }
}

module.exports = {
  InMemoryRoomStore
};
