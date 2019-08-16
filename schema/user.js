const { gql, AuthenticationError } = require("apollo-server-express");
const dbPromise = require("../connectors/sqlite");
// We define a schema that encompasses all of the types
// necessary for the functionality in this file.
module.exports.schema = gql`
  type User {
    user_id: ID!
    name: String!
    photoURL: String
    games: [Game]
  }

  # We can extend other graphQL types using the "extend" keyword.
  extend type Query {
    me: User
  }

  extend type Mutation {
    createUser(name: String!, photoURL: String): User
  }
`;

// We define all of the resolvers necessary for
// the functionality in this file. These will be
// deep merged with the other resolvers.
module.exports.resolver = {
  Query: {
    async me(_, __, context) {
      const db = await dbPromise;

      return db.get(`SELECT * FROM user WHERE user_id = $id`, {
        $id: context.user.user_id
      });
    }
  },
  Mutation: {
    async createUser(_, { name, photoURL }, context) {
      if (!context.user)
        throw new AuthenticationError(
          "Must be logged in to create user reference."
        );
      const db = await dbPromise;

      await db.run(
        `INSERT INTO user (name, photoURL) VALUES ($name, $photoURL)`,
        { $name: name, $photoURL: photoURL }
      );
      return {
        id: context.user.uid,
        displayName,
        photoURL
      };
    }
  },
  User: {
    async games(user) {
      const db = await dbPromise;

      return db.all(
        `SELECT * FROM game WHERE game_id in (SELECT game_id FROM game_user WHERE user_id = $id)`,
        { $id: user.user_id }
      );
    }
  }
};
