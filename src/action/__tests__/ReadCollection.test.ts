import ReadCollection from 'prism/action/ReadCollection';
import ReadItem from 'prism/action/ReadItem';
import Root from 'prism/action/Root';
import Document from 'prism/document';
import Registry from 'prism/registry';
import * as resource from 'prism/__mocks__/resource';

var readTasks: ReadCollection;

beforeEach(() => {
  readTasks = new ReadCollection(resource.tasks);
});

describe('#path', () => {
  it('is resource name', () => {
    expect(readTasks.path).toBe('tasks');
  });
});

describe('#query()', () => {
  it('returns a read collection query', () => {
    var query = readTasks.query({}, undefined as any);
    expect(query).toEqual({
      return: 'collection',
      source: resource.tasks.name,
      schema: resource.tasks.schema,
      conditions: [],
      joins: [{
        source: 'users',
        path:   ['tasks', 'users'],
        from:   'owner',
        to:     'id'
      }, {
        source: 'projects',
        path:   ['tasks', 'projects'],
        from:   'project',
        to:     'id'
      }],
      order: [],
      page: {
        number: 1,
        size: 20
      }
    });
  });

  it('converts `params.where` into conditions', () => {
    var params = {
      where: {
        owner: 'user1'
      }
    };

    var query = readTasks.query(params, undefined as any);
    expect(query.conditions).toEqual([{
      field: 'owner',
      value: 'user1'
    }]);
  });

  it('converts `params.order` into order clauses', () => {
    var params = {
      order: {
        'id': 'desc'
      }
    };

    var query = readTasks.query(params, undefined as any);
    expect(query.order).toEqual([{
      field: 'id',
      direction: 'desc'
    }]);
  });

  it('uses `params.page` to determine page number', () => {
    var params = {
      page: '6'
    };

    var query = readTasks.query(params, undefined as any);
    expect(query.page).toEqual({
      number: 6,
      size:   20
    });
  });
});

describe('#decorate()', () => {
  it('adds pagination links', () => {
    var tests = [{
      page: '1',
      expectedLinks: [{
        rel: 'next',
        params: {
          page: 2
        }
      }, {
        rel: 'last',
        params: {
          page: 3
        }
      }]
    }, {
      page: '2',
      expectedLinks: [{
        rel: 'first',
        params: {
          page: 1
        }
      }, {
        rel: 'prev',
        params: {
          page: 1
        }
      }, {
        rel: 'next',
        params: {
          page: 3
        }
      }, {
        rel: 'last',
        params: {
          page: 3
        }
      }]
    }, {
      page: '3',
      expectedLinks: [{
        rel: 'first',
        params: {
          page: 1
        }
      }, {
        rel: 'prev',
        params: {
          page: 2
        }
      }]
    }];

    tests.forEach(({page, expectedLinks}) => {
      var params = {page};
      var document = new Document({
        items: [],
        count: 55
      });

      readTasks.decorate(document, params, undefined as any);

      expect(document.links).toEqual(expectedLinks);
    })
  });

  it('embeds each document in `items` and omits `items`', () => {
    var document = new Document({
      items: [{
        id: 'task1',
        owner: 'user1',
        project: 'project1',
        users: {
          id: 'user1',
          name: 'Test User 1',
          department: 'department1'
        },
        projects: {
          id: 'project1',
          name: 'Test Project 1'
        }
      }, {
        id: 'task2',
        owner: 'user2',
        project: 'project2',
        users: {
          id: 'user2',
          name: 'Test User 2',
          department: 'department2'
        },
        projects: {
          id: 'project2',
          name: 'Test Project 2'
        }
      }],
      count: 2
    });

    readTasks.decorate(document, {}, undefined as any);

    var task1        = new Document(document.properties['items'][0]);
    var task1user    = new Document(document.properties['items'][0]['users']);
    var task1project = new Document(document.properties['items'][0]['projects']);

    Object.assign(task1, {
      embedded: [{
        rel: 'users',
        document: task1user
      }, {
        rel: 'projects',
        document: task1project
      }],

      omit: ['users', 'projects']
    });

    expect(document.embedded[0]).toEqual({
      rel: 'tasks',
      document: task1
    });

    var task2        = new Document(document.properties['items'][1]);
    var task2user    = new Document(document.properties['items'][1]['users']);
    var task2project = new Document(document.properties['items'][1]['projects']);

    Object.assign(task2, {
      embedded: [{
        rel: 'users',
        document: task2user
      }, {
        rel: 'projects',
        document: task2project
      }],

      omit: ['users', 'projects']
    });

    expect(document.embedded[1]).toEqual({
      rel: 'tasks',
      document: task2
    });

    expect(document.omit).toEqual(['items']);
  });
});

describe('filters', () => {
  var registry: Registry;
  var root: Root;
  var readUsers: ReadCollection;
  var readUser: ReadItem
  var readProject: ReadItem;

  beforeEach(() => {
    registry = new Registry();
    root = new Root();
    readUsers = new ReadCollection(resource.users);
    readUser = new ReadItem(resource.users);
    readProject = new ReadItem(resource.projects);

    registry.registerAction(root);
    registry.registerAction(readTasks);
  });

  it('adds a link to itself to the Root action', () => {
    var document = new Document({});
    root.decorate(document);

    expect(document.links).toEqual([{
      rel:  resource.tasks.name,
      href: readTasks.path,
      name: 'collection'
    }]);
  });

  it('adds links to itself to parent ReadItem actions', () => {
    registry.registerAction(readUser);
    registry.registerAction(readProject);

    var user = new Document({
      id: 'user1'
    });

    readUser.decorate(user, {}, undefined as any);

    expect(user.links).toEqual([{
      rel: 'tasks',
      href: readTasks.path,
      name: 'collection',
      params: {
        where: {
          owner: 'user1'
        }
      }
    }]);

    var project = new Document({
      id: 'project1'
    });

    readProject.decorate(project, {}, undefined as any);

    expect(project.links).toEqual([{
      rel: 'tasks',
      href: readTasks.path,
      name: 'collection',
      params: {
        where: {
          project: 'project1'
        }
      }
    }]);
  });

  it('recursively joins itself as a parent on child queries', () => {
    registry.registerAction(readUsers);

    var query = readTasks.joins({}, undefined as any);
    expect(query).toEqual([{
      source: 'users',
      path:   ['tasks', 'users'],
      from:   'owner',
      to:     'id'
    }, {
      source: 'projects',
      path:   ['tasks', 'projects'],
      from:   'project',
      to:     'id'
    }, {
      source: 'departments',
      path:   ['tasks', 'users', 'departments'],
      from:   'department',
      to:     'id'
    }]);
  });
});