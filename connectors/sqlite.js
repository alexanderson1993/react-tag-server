const sqlite = require("sqlite");
const dbPromise = sqlite.open("./database.sqlite", { Promise });
async function init() {
  const db = await dbPromise;
  db.run(`CREATE TABLE IF NOT EXISTS user (
    user_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    photoURL TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS game (
    game_id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    completed INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT,
    start_time INTEGER,
    started INTEGER, 
    winner_id INTEGER,

    FOREIGN KEY(owner_id) references user(user_id),
    FOREIGN KEY(winner_id) references user(user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS game_user (
    game_user_id INTEGER PRIMARY KEY,
    game_id INTEGER,
    user_id INTEGER,
    target_id INTEGER,

    FOREIGN KEY(game_id) references game(game_id),
    FOREIGN KEY(user_id) references user(user_id),
    FOREIGN KEY(target_id) references user(user_id)
  )`);
}
init();
module.exports = dbPromise;
