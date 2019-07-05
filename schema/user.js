const { gql, AuthenticationError } = require("apollo-server-express");
const { firestore } = require("../connectors/firebase");
// We define a schema that encompasses all of the types
// necessary for the functionality in this file.
module.exports.schema = gql`
  type User {
    id: ID!
    displayName: String!
    photoURL: String
    games: [Game]
  }

  # We can extend other graphQL types using the "extend" keyword.
  extend type Query {
    me: User
  }

  extend type Mutation {
    createUser(displayName: String!, photoURL: String): User
  }
`;

// We define all of the resolvers necessary for
// the functionality in this file. These will be
// deep merged with the other resolvers.
module.exports.resolver = {
  Query: {
    me(_, __, context) {
      return firestore()
        .collection("users")
        .doc(context.user.uid)
        .get();
    }
  },
  Mutation: {
    async createUser(_, { displayName, photoURL }, context) {
      if (!context.user)
        throw new AuthenticationError(
          "Must be logged in to create user reference."
        );
      await firestore()
        .collection("users")
        .doc(context.user.uid)
        .set({
          id: context.user.uid,
          displayName,
          photoURL
        });
      return {
        id: context.user.uid,
        displayName,
        photoURL
      };
    }
  },
  User: {
    async games(user) {
      const games = await firestore()
        .collection("games")
        .where("players", "array-contains", user.id)
        .get();
      return games.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  }
};
