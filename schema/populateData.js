const dbPromise = require("../connectors/sqlite");
const randomWords = require("random-words");

const users = [
  { photoURL: "flange.png", name: "Flange Niblick" },
  { photoURL: "400px-Allrianne.jpg", name: "Allrianne" },
  { photoURL: "400px-Breeze.jpg", name: "Breeze" },
  { photoURL: "400px-Clubs_portrait.jpg", name: "Clubs" },
  { photoURL: "400px-Dockson_portrait.jpg", name: "Dockson" },
  { photoURL: "400px-Elend_Shuravf.jpg", name: "Elend" },
  { photoURL: "400px-Ham_portrait.jpg", name: "Hammond" },
  { photoURL: "400px-Rashek_movie_concept.jpg", name: "Rashek" },
  { photoURL: "400px-Tindwyl_portrait.jpg", name: "Tindwyl" },
  { photoURL: "400px-Vin_portrait.jpg", name: "Vin" },
  { photoURL: "Kelsier_by_Nevena_Marković.jpg", name: "Kelsier" },
  { photoURL: "Marsh_by_eyeronis.jpg", name: "Marsh" },
  { photoURL: "Sazed_portrait.jpg", name: "Sazed" },
  { photoURL: "Spook_color.jpg", name: "Spook" }
];

module.exports = async function populateData() {
  const db = await dbPromise;
  await Promise.all(
    users.map((user, i) => {
      return db.run(
        `INSERT INTO user (user_id, name, photoURL) VALUES ($id, $name, $photoURL)`,
        {
          $id: i + 1,
          $name: user.name,
          $photoURL: `/profiles/${user.photoURL}`
        }
      );
    })
  );
  await Promise.all(
    Array.from({ length: 10 }).map(async (_, i) => {
      await db.run(
        `INSERT INTO game (game_id, name, description, code, owner_id, started, completed) VALUES ($game_id, $name,
      $description,
      $code,
      $owner_id,
      $started,
      $completed)`,
        {
          $game_id: i + 1,
          $name: `Game ${i + 1}`,
          $description: `A friendly game of assassin! Just poke your opponent with a spoon.`,
          $code: randomWords(2)
            .join("-")
            .toLowerCase(),
          $owner_id: 1,
          $started: false,
          $completed: false
        }
      );

      await Promise.all(
        Array.from({ length: 13 }).map(async (_, ii) => {
          await db.run(
            `INSERT INTO game_user (game_id, user_id) VALUES ($game_id, $user_id)`,
            { $game_id: i + 1, $user_id: ii + 1 }
          );
        })
      );
    })
  );
};
