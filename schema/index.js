const { makeExecutableSchema, gql } = require("apollo-server-express");
const { merge } = require("lodash");

const { schema: ScalarSchema, resolver: ScalarResolver } = require("./scalars");
const { schema: UserSchema, resolver: UserResolver } = require("./user");
const { schema: GameSchema, resolver: GameResolver } = require("./game");

const MainSchema = gql`
  type Query {
    # Types cannot be empty. Since we extend this type elsewhere,
    # we must add something to this type here.
    _empty: String
  }
  type Mutation {
    _empty: String
  }
  type Subscription {
    _empty: String
  }
`;

// This resolver object can be extended if properties are added
// to the Query and Mutation types above.
const MainResolver = {};

// We collect the schemas and resolvers from the different
// functionally-separated files, and merge them together into
// a single schema.
module.exports = makeExecutableSchema({
  typeDefs: [MainSchema, ScalarSchema, UserSchema, GameSchema],
  resolvers: merge(MainResolver, ScalarResolver, UserResolver, GameResolver)
});
