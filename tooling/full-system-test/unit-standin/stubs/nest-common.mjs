// @nestjs/common stand-in: decorators are no-ops; the runtime classes the logic uses behave like Nest's.
import { Readable } from 'node:stream';
const deco = () => () => undefined;
export const Injectable = deco, Controller = deco, Module = deco, Get = deco, Post = deco, Put = deco, Patch = deco, Delete = deco, Body = deco, Query = deco,
  Req = deco, Res = deco, Param = deco, Headers = deco, UseGuards = deco, UseInterceptors = deco, Inject = deco, Optional = deco, Header = deco, HttpCode = deco,
  SetMetadata = deco, UploadedFile = deco, UploadedFiles = deco, Global = deco;
export const forwardRef = (f) => f;
export class Logger { constructor(ctx) { this.ctx = ctx; } log() {} warn(m) { (globalThis.__warns ??= []).push(String(m)); } error() {} debug() {} verbose() {} static warn() {} static log() {} static error() {} }
export const HttpStatus = { OK: 200, CREATED: 201, ACCEPTED: 202, NO_CONTENT: 204, BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, GONE: 410, UNPROCESSABLE_ENTITY: 422, TOO_MANY_REQUESTS: 429, INTERNAL_SERVER_ERROR: 500, SERVICE_UNAVAILABLE: 503 };
export class HttpException extends Error { constructor(response, status) { super(typeof response === 'string' ? response : response?.message ?? 'Http Exception'); this.response = response; this.status = status; } getResponse() { return this.response; } getStatus() { return this.status; } }
const ex = (code, name) => class extends HttpException { constructor(r) { super(r ?? name, code); } };
export const BadRequestException = ex(400, 'Bad Request'), UnauthorizedException = ex(401, 'Unauthorized'), ForbiddenException = ex(403, 'Forbidden'), NotFoundException = ex(404, 'Not Found'),
  ConflictException = ex(409, 'Conflict'), GoneException = ex(410, 'Gone'), InternalServerErrorException = ex(500, 'Internal'), ServiceUnavailableException = ex(503, 'Unavailable');
export class StreamableFile { constructor(buf, options = {}) { this.buf = buf; this.options = options; } getStream() { return Readable.from([this.buf]); } getHeaders() { return { type: this.options.type ?? 'application/octet-stream', disposition: this.options.disposition, length: this.options.length }; } }
export const RequestMethod = { GET: 0, POST: 1, PUT: 2, DELETE: 3, PATCH: 4, ALL: 5 };
// interface names some files import without `import type` (TypeScript elides them; Node's stripper does not)
const I = undefined;
export const CanActivate = I, ExecutionContext = I, NestInterceptor = I, CallHandler = I, PipeTransform = I, ArgumentMetadata = I, OnModuleInit = I, OnModuleDestroy = I,
  NestMiddleware = I, Type = I, DynamicModule = I, Provider = I, ArgumentsHost = I, ExceptionFilter = I, INestApplication = I, MiddlewareConsumer = I, NestModule = I,
  OnApplicationBootstrap = I, OnApplicationShutdown = I, ValueProvider = I, FactoryProvider = I, CustomDecorator = I, LoggerService = I, BeforeApplicationShutdown = I;
export const createParamDecorator = () => () => () => undefined;
export const applyDecorators = () => () => undefined;
export const Catch = () => () => undefined, Scope = { DEFAULT: 0, TRANSIENT: 1, REQUEST: 2 }, ValidationPipe = class {}, ParseIntPipe = class {}, ParseUUIDPipe = class {};
export const PayloadTooLargeException = ex(413, 'Payload Too Large'), TooManyRequestsException = ex(429, 'Too Many'), NotImplementedException = ex(501, 'NI'), PreconditionFailedException = ex(412, 'PF'), UnprocessableEntityException = ex(422, 'UE'), MethodNotAllowedException = ex(405, 'MNA'), RequestTimeoutException = ex(408, 'RT'), BadGatewayException = ex(502, 'BG'), GatewayTimeoutException = ex(504, 'GT');
