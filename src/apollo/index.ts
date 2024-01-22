import { ApolloServer, ContextFunction } from '@apollo/server';
import authUtils from 'src/auth/authUtils';
import Debug from 'debug';
import type { Request, Response } from 'express';

const debug = Debug('web-jam-back:apollo');
// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
const typeDefs = `#graphql
  # Comments in GraphQL strings (such as this one) start with the hash (#) symbol.

  # This "Book" type defines the queryable fields for every book in our data source.
  type QqlDocs {
    title: String
    author: String
  }

  # The "Query" type is special: it lists all of the available queries that
  # clients can execute, along with the return type for each. In this
  # case, the "books" query returns an array of zero or more Books (defined above).
  type Query {
    gqldocs: [QqlDocs]
  }
`;

const gqldocs = [
  {
    title: 'The Awakening',
    author: 'Kate Chopin',
  },
  {
    title: 'City of Glass',
    author: 'Paul Auster',
  },
];

// Resolvers define how to fetch the types defined in your schema.
// This resolver retrieves books from the "books" array above.
export const resolvers = {
  Query: {
    gqldocs: () => gqldocs,
  },
};

// The ApolloServer constructor requires two parameters: your schema
// definition and your set of resolvers.
const server = new ApolloServer({
  typeDefs,
  resolvers,
});

const context:ContextFunction<any> = async ({ request, response }: { request: Request, response: Response }) => {
  try {
    await authUtils.ensureAuthenticated(request);
  } catch (err) { 
    debug(`graphql ensure authenticated error ${(err as Error).message}`); 
    // return response.status(500).json({ status: 500, error: err }); 
  }
  console.log(request);
  return ({
    // Add optional configuration options
    request,
    response,
  });
};

export default { server, context };
