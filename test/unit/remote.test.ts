import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArgumentError, bindArguments, KeywordLibrary, robotArgumentSpec, type KeywordDefinition } from '../../src/remote/keywordLibrary.js';
import { encodeFault, encodeMethodResponse, encodeValue, parseMethodCall, XmlRpcParseError } from '../../src/remote/xmlRpc.js';

// Request as produced by Python's xmlrpc.client for
// run_keyword('Send API Request', ['GET', '/users'], {'expected_status': 200, 'params': {'a': 'b'}})
const PYTHON_REQUEST = `<?xml version='1.0'?>
<methodCall>
<methodName>run_keyword</methodName>
<params>
<param>
<value><string>Send API Request</string></value>
</param>
<param>
<value><array><data>
<value><string>GET</string></value>
<value><string>/users &amp; more</string></value>
</data></array></value>
</param>
<param>
<value><struct>
<member>
<name>expected_status</name>
<value><int>200</int></value>
</member>
<member>
<name>params</name>
<value><struct>
<member>
<name>a</name>
<value><string>  b  </string></value>
</member>
</struct></value>
</member>
<member>
<name>flag</name>
<value><boolean>1</boolean></value>
</member>
<member>
<name>ratio</name>
<value><double>0.5</double></value>
</member>
<member>
<name>empty</name>
<value><string></string></value>
</member>
<member>
<name>untyped</name>
<value>plain</value>
</member>
</struct></value>
</param>
</params>
</methodCall>
`;

describe('xmlRpc', () => {
  it('parses a Python xmlrpc.client request, preserving whitespace inside strings', () => {
    const call = parseMethodCall(PYTHON_REQUEST);
    assert.equal(call.methodName, 'run_keyword');
    assert.deepEqual(call.params, [
      'Send API Request',
      ['GET', '/users & more'],
      { expected_status: 200, params: { a: '  b  ' }, flag: true, ratio: 0.5, empty: '', untyped: 'plain' },
    ]);
  });

  it('parses requests without params, nil, base64 and empty arrays', () => {
    assert.deepEqual(parseMethodCall('<methodCall><methodName>get_keyword_names</methodName></methodCall>').params, []);
    const call = parseMethodCall('<methodCall><methodName>x</methodName><params>'
      + '<param><value><nil/></value></param>'
      + '<param><value><base64>aGk=</base64></value></param>'
      + '<param><value><array><data></data></array></value></param>'
      + '</params></methodCall>');
    assert.equal(call.params[0], null);
    assert.equal((call.params[1] as Buffer).toString(), 'hi');
    assert.deepEqual(call.params[2], []);
  });

  it('rejects malformed requests with a parse error', () => {
    assert.throws(() => parseMethodCall('<methodCall><methodName>x'), XmlRpcParseError);
    assert.throws(() => parseMethodCall('<notACall/>'), /does not contain <methodCall>/);
    assert.throws(() => parseMethodCall('<methodCall><methodName>x</methodName><params><param><value><int>abc</int></value></param></params></methodCall>'), /Invalid integer/);
  });

  it('encodes scalars with the XML-RPC types Python expects', () => {
    assert.equal(encodeValue(42), '<value><int>42</int></value>');
    assert.equal(encodeValue(2 ** 40), '<value><i8>1099511627776</i8></value>');
    assert.equal(encodeValue(1.5), '<value><double>1.5</double></value>');
    assert.equal(encodeValue(true), '<value><boolean>1</boolean></value>');
    assert.equal(encodeValue(undefined), '<value><nil/></value>');
    assert.equal(encodeValue('a<b>&c'), '<value><string>a&lt;b&gt;&amp;c</string></value>');
  });

  it('replaces characters that are invalid in XML', () => {
    assert.equal(encodeValue('a\u0001b'), '<value><string>a�b</string></value>');
  });

  it('encodes nested structures and round-trips them', () => {
    const value = { list: [1, 'two', null, { deep: false }], text: '<x>' };
    const xml = encodeMethodResponse(value).replace('methodResponse', 'methodCall').replace('methodResponse', 'methodCall')
      .replace('<methodCall>', '<methodCall><methodName>echo</methodName>');
    assert.deepEqual(parseMethodCall(xml).params[0], value);
  });

  it('refuses circular structures', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    assert.throws(() => encodeValue(value), /circular/);
  });

  it('encodes faults as faultCode/faultString structs', () => {
    assert.match(encodeFault(1, 'bad'), /<fault><value><struct><member><name>faultCode<\/name><value><int>1<\/int><\/value><\/member><member><name>faultString<\/name><value><string>bad<\/string>/);
  });
});

const keyword: KeywordDefinition = {
  name: 'Send API Request',
  doc: 'doc',
  params: [
    { name: 'method', type: 'str' },
    { name: 'body', default: null },
    { name: 'expected_status', default: null, type: 'int | None', namedOnly: true },
    { name: 'authenticated', default: true, type: 'bool', namedOnly: true },
  ],
  run: (args) => args,
};

describe('keywordLibrary', () => {
  it('derives the Robot argument spec including named-only marker and defaults', () => {
    assert.deepEqual(robotArgumentSpec(keyword.params), ['method', 'body=None', '*', 'expected_status=None', 'authenticated=True']);
  });

  it('binds positional and named arguments and fills defaults', () => {
    assert.deepEqual(bindArguments(keyword, ['GET'], { expected_status: 200 }), {
      method: 'GET', body: null, expected_status: 200, authenticated: true,
    });
  });

  it("treats '' (Robot's encoding of None) as not given for None defaults", () => {
    assert.equal(bindArguments(keyword, ['GET', ''], {}).body, null);
  });

  it('reports missing, unexpected and duplicate arguments', () => {
    assert.throws(() => bindArguments(keyword, [], {}), /missing value for argument 'method'/);
    assert.throws(() => bindArguments(keyword, ['GET'], { nope: 1 }), /unexpected named argument 'nope'/);
    assert.throws(() => bindArguments(keyword, ['GET'], { method: 'POST' }), /multiple values/);
    assert.throws(() => bindArguments(keyword, ['GET', 'b', 'c'], {}), ArgumentError);
  });

  it('serves library information with __intro__ and __init__ and finds keywords like Robot does', () => {
    const library = new KeywordLibrary('intro', [keyword]);
    const info = library.information();
    assert.equal(info.__intro__?.doc, 'intro');
    assert.ok(info.__init__);
    assert.deepEqual(info['Send API Request']?.types, { method: 'str', expected_status: 'int | None', authenticated: 'bool' });
    assert.equal(library.get('send_api_request'), keyword);
    assert.equal(library.get('SEND API REQUEST'), keyword);
    assert.throws(() => library.add(keyword), /Duplicate keyword/);
  });
});
