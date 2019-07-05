const { gql, UserInputError } = require("apollo-server-express");
const pubsub = require("../helpers/pubsub");
const { firestore } = require("../connectors/firebase");
const randomWords = require("random-words");
const { withFilter } = require("apollo-server");

function shuffle(array) {
  array.sort(() => Math.random() - 0.5);
}

// We define a schema that encompasses all of the types
// necessary for the functionality in this file.
module.exports.schema = gql`
  type Game {
    id: ID!
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
    notification(playerId: ID!): String
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
      const games = await firestore()
        .collection("games")
        .where("players", "array-contains", context.user.uid)
        .get();
      return games.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async game(_, { gameId, code }, context) {
      if (code) {
        const games = await firestore()
          .collection("games")
          .where("code", "==", code)
          .get();
        const game = games.docs[0];
        if (!game) return null;
        return { id: game.id, ...game.data() };
      }
      const game = await firestore()
        .collection("games")
        .doc(gameId)
        .get();
      const data = game.data();
      if (data.players && data.players.includes(context.user.uid))
        return { id: game.id, ...data };
      return null;
    }
  },
  Mutation: {
    async createGame(_, { name, description }, context) {
      const game = {
        name,
        description,
        code: randomWords(2)
          .join("-")
          .toLowerCase(),
        owner: context.user.uid,
        started: false,
        completed: false,
        players: [context.user.uid],
        playerCount: 1,
        aliveCount: 1
      };
      const gameObj = await firestore()
        .collection("games")
        .add(game);
      const data = await gameObj.get();
      return { id: data.id, ...data.data() };
    },
    async joinGame(_, { code }, context) {
      const games = await firestore()
        .collection("games")
        .where("code", "==", code.toLowerCase())
        .get();
      const game = games.docs[0];
      if (!game) throw new UserInputError("Invalid game code.");
      if (game.started)
        throw new UserInputError("Cannot join game that has already started.");

      const data = game.data();
      const players = data.players || [];

      if (players.includes(context.user.uid)) {
        throw new UserInputError("Already part of this game.");
      }
      const playerCount = data.playerCount;
      const aliveCount = data.aliveCount;

      players.push(context.user.uid);
      await game.ref.update({
        players,
        playerCount: playerCount + 1,
        aliveCount: aliveCount + 1
      });
      const updatedGame = await game.ref.get();
      pubsub.publish(GAME_UPDATE, {
        id: updatedGame.id,
        ...updatedGame.data()
      });

      return { id: updatedGame.id, ...updatedGame.data() };
    },
    async startGame(_, { gameId }, context) {
      const game = await firestore()
        .collection("games")
        .doc(gameId)
        .get();
      if (!game) throw new UserInputError("Invalid game id.");
      const data = game.data();
      if (data.owner !== context.user.uid)
        throw new UserInputError("Must own game to start.");
      if (data.playerCount < 3)
        throw new UserInputError("Must have at least 5 players to start.");

      let players = data.players.concat();

      const targets = {};
      let targetPlayer = players.pop();
      let firstPlayer = targetPlayer;
      while (players.length > 0) {
        shuffle(players);
        const newPlayer = players.pop();
        targets[targetPlayer] = newPlayer;
        targetPlayer = newPlayer;
      }
      targets[targetPlayer] = firstPlayer;
      const update = {
        started: true,
        startTime: new Date(),
        targets
      };

      const message = `The game ${data.name} has started.`;
      pubsub.publish(NOTIFICATION, { game: data, message });

      await game.ref.update(update);
      const gameUpdateData = await game.ref.get();
      pubsub.publish(GAME_UPDATE, {
        id: gameUpdateData.id,
        ...gameUpdateData.data()
      });

      return { id: gameUpdateData.id, ...gameUpdateData.data() };
    },
    async surrender(_, { gameId }, context) {
      const game = await firestore()
        .collection("games")
        .doc(gameId)
        .get();
      if (!game) throw new UserInputError("Invalid game id.");
      const data = game.data();
      if (!data.players.includes(context.user.uid))
        throw new UserInputError(
          "Can't surrender to a game you aren't part of."
        );
      const { [context.user.uid]: playerTarget, ...targets } = data.targets;
      const [enemyId] = Object.entries(targets).find(
        ([enemyId, playerId]) => playerId === context.user.uid
      );

      const update = {
        aliveCount: data.aliveCount - 1,
        targets: { ...targets, [enemyId]: playerTarget }
      };
      const enemyPlayer = await firestore()
        .collection("users")
        .doc(enemyId)
        .get();

      if (enemyId === playerTarget) {
        // We have a winner!
        update.completed = true;
        update.winner = enemyId;

        const message = `${enemyPlayer.data().displayName} won the game "${
          data.name
        }"!`;
        pubsub.publish(NOTIFICATION, { game: data, message });
      } else {
        const currentPlayer = await firestore()
          .collection("users")
          .doc(context.user.uid)
          .get();

        const message = `${enemyPlayer.data().displayName} has eliminated ${
          currentPlayer.data().displayName
        }.`;
        pubsub.publish(NOTIFICATION, { game: data, message });
      }
      await game.ref.update(update);
      const updatedGame = await game.ref.get();
      const updatedGameData = { id: updatedGame.id, ...updatedGame.data() };
      pubsub.publish(GAME_UPDATE, updatedGameData);

      return updatedGameData;
    }
  },
  Subscription: {
    gameUpdate: {
      resolve(payload) {
        console.log(payload);
        return payload;
      },
      subscribe: withFilter(
        () => pubsub.asyncIterator([GAME_UPDATE]),
        (payload, variables, context) => {
          return (
            payload.id === variables.gameId ||
            payload.players.includes(context.user.uid)
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
        (payload, variables, context) => {
          return payload.game.players.includes(context.user.uid);
        }
      )
    }
  },
  Game: {
    async owner(game) {
      const user = await firestore()
        .collection("users")
        .doc(game.owner)
        .get();
      return { id: user.id, ...user.data() };
    },
    async winner(game, _, context) {
      context.game = game;
      if (!game.winner) return null;
      const user = await firestore()
        .collection("users")
        .doc(game.winner)
        .get();
      return { id: user.id, ...user.data() };
    },
    me(game, _, context) {
      context.game = game;
      return context.user.uid;
    },
    players(game, _, context) {
      context.game = game;
      return game.players;
    }
  },
  Player: {
    id(playerId) {
      return playerId;
    },
    async user(playerId) {
      const user = await firestore()
        .collection("users")
        .doc(playerId)
        .get();
      return { id: user.id, ...user.data() };
    },
    async target(playerId, _, { game }) {
      if (!game || !game.targets) return null;
      const target = game.targets[playerId];
      if (!target) return null;

      return target;
    },
    async dead(playerId, _, { game }) {
      if (!game) return false;
      if (!game.started) return false;
      if (!game.targets[playerId]) return true;
      return false;
    }
  }
};
