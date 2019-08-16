const { ApolloServer } = require("apollo-server");
const schema = require("./schema");

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

    return { user: { user_id: token } };
  }
});

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`🚀 Server ready at ${url}`);
  console.log(`🚀 Subscriptions ready at ${subscriptionsUrl}`);
});
