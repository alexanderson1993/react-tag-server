const { gql, UserInputError } = require("apollo-server-express");
const pubsub = require("../helpers/pubsub");
const dbPromise = require("../connectors/sqlite");
const randomWords = require("random-words");
const { withFilter } = require("apollo-server");

function shuffle(array) {
  array.sort(() => Math.random() - 0.5);
}

// We define a schema that encompasses all of the types
// necessary for the functionality in this file.
module.exports.schema = gql`
  type Game {
    game_id: ID!
    name: String!
    code: String!
    owner: User
    description: String
    started: Boolean
    startTime: Date
    completed: Boolean
    winner: User
    me: Player
    players: [Player]
    playerCount: Int
    aliveCount: Int
  }

  type Player {
    id: ID!
    user: User
    target: Player
    dead: Boolean
  }
  # We can extend other graphQL types using the "extend" keyword.
  extend type Query {
    games: [Game]
    game(gameId: ID, code: String): Game
  }

  extend type Mutation {
    createGame(name: String!, description: String!): Game
    joinGame(code: String!): Game
    startGame(gameId: ID!): Game
    surrender(gameId: ID!): Game
  }

  extend type Subscription {
    gameUpdate(gameId: ID, playerId: ID): Game
    notification: String
  }
`;

const GAME_UPDATE = "GAME_UPDATE";
const NOTIFICATION = "NOTIFICATION";
// We define all of the resolvers necessary for
// the functionality in this file. These will be
// deep merged with the other resolvers.
module.exports.resolver = {
  Query: {
    async games(_, __, context) {
      const db = await dbPromise;
      const data = await db.all(
        `SELECT * FROM game WHERE game_id in (SELECT game_id FROM game_user WHERE user_id = $id)`,
        { $id: context.user.user_id }
      );
      return data;
    },
    async game(_, { gameId, code }, context) {
      const db = await dbPromise;
      if (code) {
        return db.get(`SELECT * FROM game WHERE code = $code`, {
          $code: code
        });
      }
      return db.get(`SELECT * FROM game WHERE game_id = $id`, {
        $id: gameId
      });
    }
  },
  Mutation: {
    async createGame(_, { name, description }, context) {
      const db = await dbPromise;

      const game = {
        $name: name,
        $description: description,
        $code: randomWords(2)
          .join("-")
          .toLowerCase(),
        $owner_id: context.user.user_id,
        $started: false,
        $completed: false
      };
      const {
        stmt: { lastID }
      } = await db.run(
        `INSERT INTO game (name, description, code, owner_id, started, completed) VALUES ($name,
            $description,
            $code,
            $owner_id,
            $started,
            $completed)`,
        game
      );
      return db.get(`SELECT * FROM game WHERE game_id = $lastID`, {
        $lastID: lastID
      });
    },
    async joinGame(_, { code }, context) {
      const db = await dbPromise;

      const game = await db.get(`SELECT * FROM game WHERE code = $code`, {
        $code: code
      });
      if (!game) throw new UserInputError("Invalid game code.");
      if (game.started)
        throw new UserInputError("Cannot join game that has already started.");

      const players = await db.all(
        `SELECT * FROM game_user WHERE game_id = $gameID`,
        { $gameID: game.game_id }
      );

      if (players.find(({ user_id }) => user_id === context.user.user_id)) {
        throw new UserInputError("Already part of this game.");
      }

      await db.run(
        `INSERT INTO game_user (game_id, user_id) VALUES ($game_id, $user_id)`,
        { $game_id: game.game_id, $user_id: context.user.user_id }
      );

      pubsub.publish(GAME_UPDATE, game);

      return game;
    },
    async startGame(_, { gameId }, context) {
      const db = await dbPromise;

      const game = await db.get(`SELECT * FROM game WHERE game_id = $gameId`, {
        $gameId: gameId
      });

      if (!game) throw new UserInputError("Invalid game id.");
      if (game.owner_id !== context.user.user_id)
        throw new UserInputError("Must own game to start.");

      const playerList = await db.all(
        `SELECT * FROM game_user WHERE game_id = $gameID`,
        { $gameID: game.game_id }
      );

      if (playerList.length < 3)
        throw new UserInputError("Must have at least 5 players to start.");

      const targets = {};
      let targetPlayer = playerList.pop().user_id;
      let firstPlayer = targetPlayer;
      while (playerList.length > 0) {
        shuffle(playerList);
        const newPlayer = playerList.pop().user_id;
        targets[targetPlayer] = newPlayer;
        targetPlayer = newPlayer;
      }
      targets[targetPlayer] = firstPlayer;

      // Push the updated values to the database
      await Promise.all(
        Object.entries(targets).map(([$userId, $targetId]) => {
          return db.run(
            `UPDATE game_user SET target_id = $targetId WHERE game_id = $gameId AND user_id = $userId`,
            { $targetId, $userId, $gameId: game.game_id }
          );
        })
      );

      await db.run(
        `UPDATE game SET started = 1, start_time = $startTime WHERE game_id = $gameId`,
        { $gameId: game.game_id, $startTime: Date.now() }
      );

      const message = `The game ${game.name} has started.`;
      pubsub.publish(NOTIFICATION, { game, message });
      const gameUpdateData = await db.get(
        `SELECT * FROM game WHERE game_id = $gameId`,
        {
          $gameId: gameId
        }
      );
      pubsub.publish(GAME_UPDATE, gameUpdateData);

      return gameUpdateData;
    },
    async surrender(_, { gameId }, context) {
      const db = await dbPromise;

      const game = await db.get(`SELECT * FROM game WHERE game_id = $gameId`, {
        $gameId: gameId
      });
      if (!game) throw new UserInputError("Invalid game id.");
      const surrenderingPlayer = await db.get(
        `SELECT * FROM game_user WHERE game_id = $gameID AND user_id = $userID`,
        { $gameID: game.game_id, $userID: context.user.user_id }
      );

      if (!surrenderingPlayer)
        throw new UserInputError(
          "Can't surrender to a game you aren't part of."
        );
      await db.run(
        `UPDATE game_user SET target_id = $targetId WHERE target_id = $userId AND game_id = $gameId`,
        {
          $targetId: surrenderingPlayer.target_id,
          $userId: context.user.user_id,
          $gameId: gameId
        }
      );
      await db.run(
        `UPDATE game_user SET target_id = NULL WHERE user_id = $userId and game_id = $gameId`,
        { $userId: context.user.user_id, $gameId: gameId }
      );

      const enemy = await db.get(
        "SELECT * FROM game_user WHERE game_id = $game_id AND target_id = $targetId",
        { $game_id: gameId, $targetId: surrenderingPlayer.target_id }
      );
      const enemyData = await db.get(
        `SELECT * FROM user WHERE user_id = $enemyId`,
        { $enemyId: enemy.user_id }
      );

      if (enemy.user_id === enemy.target_id) {
        // We have a winner!
        await db.run(`UPDATE game SET completed = 1 WHERE game_id = $gameId`, {
          $gameId: game.game_id
        });
        await db.run(
          `UPDATE game SET winner_id = $enemyId WHERE game_id = $gameId`,
          { $gameId: game.game_id, $enemyId: enemy.user_id }
        );

        const message = `${enemyData.name} won the game "${game.name}"!`;
        pubsub.publish(NOTIFICATION, { game, message });
      } else {
        const currentPlayer = await db.get(
          `SELECT * FROM user WHERE user_id = $userId`,
          { $userId: context.user.user_id }
        );

        const message = `${enemyData.name} has eliminated ${currentPlayer.name}.`;
        pubsub.publish(NOTIFICATION, { game, message });
      }
      const updatedGameData = await db.get(
        `SELECT * FROM game WHERE game_id = $gameId`,
        {
          $gameId: gameId
        }
      );
      pubsub.publish(GAME_UPDATE, updatedGameData);

      return updatedGameData;
    }
  },
  Subscription: {
    gameUpdate: {
      resolve(payload) {
        return payload;
      },
      subscribe: withFilter(
        () => pubsub.asyncIterator([GAME_UPDATE]),
        async (payload, variables, context) => {
          const db = await dbPromise;
          const players = await db.all(
            `SELECT * FROM game_user WHERE game_id = $gameID`,
            { $gameID: payload.game_id }
          );
          return (
            String(payload.game_id) === String(variables.gameId) ||
            players.includes(context.user.user_id)
          );
        }
      )
    },
    notification: {
      resolve(payload) {
        return payload.message;
      },
      subscribe: withFilter(
        () => pubsub.asyncIterator([NOTIFICATION]),
        async (payload, variables, context) => {
          const db = await dbPromise;

          const players = await db.all(
            `SELECT user_id FROM game_user WHERE game_id = $gameID`,
            { $gameID: payload.game.game_id }
          );
          return Boolean(
            players.find(
              p =>
                String(p.user_id) ===
                String(context.user.user_id).replace(/"/gi, "")
            )
          );
        }
      )
    }
  },
  Game: {
    async owner(game) {
      const db = await dbPromise;

      return db.get(`SELECT * FROM user WHERE user_id = $owner`, {
        $owner: game.owner_id
      });
    },
    async winner(game, _, context) {
      const db = await dbPromise;

      context.game = game;
      if (!game.winner_id) return null;
      return db.get(`SELECT * FROM user WHERE user_id = $winner`, {
        $winner: game.winner_id
      });
    },
    me(game, _, context) {
      context.game = game;
      return context.user.user_id;
    },
    async players(game, _, context) {
      const db = await dbPromise;

      const players = await db.all(
        `SELECT * FROM game_user WHERE game_id = $gameID`,
        { $gameID: game.game_id }
      );
      return players;
    },
    async playerCount(game) {
      const db = await dbPromise;

      const players = await db.all(
        `SELECT * FROM game_user WHERE game_id = $gameID`,
        { $gameID: game.game_id }
      );
      return players.length;
    },
    async aliveCount(game) {
      const db = await dbPromise;

      const players = await db.all(
        `SELECT * FROM game_user WHERE game_id = $gameID AND target_id IS NOT NULL`,
        { $gameID: game.game_id }
      );
      return players.length;
    }
  },
  Player: {
    id(user) {
      return user && user.user_id ? user.user_id : user;
    },
    async user(playerId) {
      const db = await dbPromise;
      const id = playerId.user_id ? playerId.user_id : playerId;
      return db.get(`SELECT * FROM user WHERE user_id = $id`, {
        $id: id
      });
    },
    async target(playerId, _, { game }) {
      const db = await dbPromise;
      const id = playerId.replace(/"/gi, "");
      return db.get(
        `SELECT * FROM game_user WHERE user_id = (SELECT target_id FROM game_user WHERE user_id = $id AND game_id = $gameId) AND game_id = $gameId`,
        { $id: id, $gameId: game.game_id }
      );
    },
    async dead(playerId, _, { game }) {
      const db = await dbPromise;
      if (!game) return false;
      if (!game.started) return false;
      const id = playerId.replace(/"/gi, "");
      const player = await db.get(
        `SELECT * FROM game_user WHERE target_id = $id AND game_id = $gameId`,
        { $id: id, $gameId: game.game_id }
      );
      return !player;
    }
  }
};
