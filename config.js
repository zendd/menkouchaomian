

module.exports = Object.assign({
  neo4jHost: process.env.NEO4JHOST || 'http://121.40.230.19/',
  neo4jPort: process.env.NEO4JPORT || '7474',
  neo4jBoltPort: process.env.NEO4JBOLTPORT || '7687',
  neo4jUserName: process.env.NEO4JUSERNAME || 'neo4j',
  neo4jPassword: process.env.NEO4PASSWORD || 'j4oen',
  graphQLHost: 'http://121.40.230.19',
  graphQLPort: 8964
});
