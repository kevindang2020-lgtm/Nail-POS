// @ResourceScope — Security Deep Scan §38: declare the boundary of the records a route touches when the route's realm,
// path and permission do not decide it (see route-resource-scope.ts). On a handler or its controller; the handler wins.
// The manifest generator reads it statically; the metadata is also on the route for runtime readers.
import { SetMetadata } from '@nestjs/common';
import { RESOURCE_SCOPE_META, type RouteResourceScope } from '../route-resource-scope';

export const ResourceScope = (scope: RouteResourceScope) => SetMetadata(RESOURCE_SCOPE_META, scope);
