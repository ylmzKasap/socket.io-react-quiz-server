/* abstract */ class UserStore {
  findUser(id) {}
  saveUser(id, user) {}
  findAllUsers() {}
}

class InMemoryUserStore extends UserStore {
  constructor() {
    super();
    this.users = new Map();
  }

  findUser(id) {
    return this.users.get(id);
  }

  saveUser(id, user) {
    this.users.set(id, user);
  }

  findAllUsers() {
    return this.users.entries()
  }

  findAllUserValues() {
    return [...this.users.values()];
  }
}

module.exports = {
  InMemoryUserStore
};
