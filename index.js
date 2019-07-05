const { ApolloServer, gql } = require("apollo-server");
const schema = require("./schema");
const { auth } = require("./connectors/firebase");

const server = new ApolloServer({
  schema,
  context: async ({ req, connection }) => {
    let token = null;
    if (connection) {
      token = connection.context.authToken;
    } else {
      if (!req) return { user: null };
      token = (req.headers.authorization || "").replace("Bearer ", "");
    }
    if (!token) return { user: null };

    try {
      const user = await auth().verifyIdToken(token);
      return { user };
    } catch (error) {
      console.error(error);
      return {};
    }
  }
});

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`🚀 Server ready at ${url}`);
  console.log(`🚀 Subscriptions ready at ${subscriptionsUrl}`);
});
