const server=require('../tests/fixture.cjs').serve();
server.listen(0,'127.0.0.1',()=>console.log('Mock preview: http://127.0.0.1:'+server.address().port));
