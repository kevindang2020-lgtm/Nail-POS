// react-router-dom stand-in for the one-screen harness ONLY (the real package is not installable here). Implements the
// surface the POS uses — BrowserRouter / MemoryRouter, Routes / Route (nested, index, :params, '*'), Navigate, Link,
// NavLink, Outlet, useNavigate, useLocation, useParams, useSearchParams — on the History API. Never shipped.
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

const RouterCtx = createContext(null);
const RouteCtx = createContext({ params: {}, outlet: null, base: '' });

function parse(path) {
  const u = new URL(path, 'http://x');
  return { pathname: u.pathname, search: u.search, hash: u.hash, state: null, key: Math.random().toString(36).slice(2) };
}
function Router({ children, initial, memory }) {
  const [loc, setLoc] = useState(() => (memory ? parse(initial || '/') : { pathname: location.pathname, search: location.search, hash: location.hash, state: history.state, key: 'init' }));
  useEffect(() => {
    if (memory) return undefined;
    const on = () => setLoc({ pathname: location.pathname, search: location.search, hash: location.hash, state: history.state, key: Math.random().toString(36).slice(2) });
    addEventListener('popstate', on); return () => removeEventListener('popstate', on);
  }, [memory]);
  const navigate = useCallback((to, opts = {}) => {
    if (typeof to === 'number') { if (!memory) history.go(to); return; }
    const next = parse(typeof to === 'string' ? (to.startsWith('/') || to.startsWith('?') ? (to.startsWith('?') ? loc.pathname + to : to) : (loc.pathname.replace(/\/[^/]*$/, '') + '/' + to)) : (to.pathname || loc.pathname) + (to.search || ''));
    if (!memory) { (opts.replace ? history.replaceState : history.pushState).call(history, opts.state ?? null, '', next.pathname + next.search + next.hash); }
    setLoc({ ...next, state: opts.state ?? null });
  }, [loc.pathname, memory]);
  const value = useMemo(() => ({ location: loc, navigate }), [loc, navigate]);
  return React.createElement(RouterCtx.Provider, { value }, children);
}
export const BrowserRouter = ({ children }) => React.createElement(Router, { memory: false }, children);
export const MemoryRouter = ({ children, initialEntries }) => React.createElement(Router, { memory: true, initial: (initialEntries && initialEntries[0]) || '/' }, children);

function match(pattern, pathname, end) {
  const pp = pattern.split('/').filter(Boolean), sp = pathname.split('/').filter(Boolean); const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '*') { params['*'] = sp.slice(i).join('/'); return { params, consumed: sp.length }; }
    if (i >= sp.length) return null;
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(sp[i]); else if (pp[i] !== sp[i]) return null;
  }
  if (end && sp.length !== pp.length) return null;
  return { params, consumed: pp.length };
}
function flatten(children) {
  const out = [];
  React.Children.forEach(children, (c) => { if (!c) return; if (c.type === React.Fragment) out.push(...flatten(c.props.children)); else out.push(c); });
  return out;
}
export function Routes({ children }) {
  const { location: loc } = useContext(RouterCtx); const parent = useContext(RouteCtx);
  const rest = loc.pathname.slice(parent.base.length) || '/';
  const tryRoutes = (routes, path, base, params) => {
    for (const r of flatten(routes)) {
      const p = r.props;
      const kids = p.children ? flatten(p.children).filter((k) => k.type === Route) : [];
      if (p.index) { if (path === '/' || path === '') return { el: p.element, params, base }; continue; }
      const pat = (p.path || '').replace(/^\//, '');
      if (!pat && kids.length) { const inner = tryRoutes(kids, path, base, params); if (inner) return { el: p.element, params: inner.params, base, outlet: inner }; continue; }
      const m = match(pat, path, kids.length === 0);
      if (!m) continue;
      const consumed = '/' + path.split('/').filter(Boolean).slice(0, m.consumed).join('/');
      const nb = (base + consumed).replace(/\/+$/, '');
      if (kids.length) {
        const remaining = '/' + path.split('/').filter(Boolean).slice(m.consumed).join('/');
        const inner = tryRoutes(kids, remaining, nb, { ...params, ...m.params });
        if (inner) return { el: p.element, params: inner.params, base: nb, outlet: inner };
        if (remaining !== '/') continue;
      }
      return { el: p.element, params: { ...params, ...m.params }, base: nb };
    }
    return null;
  };
  const hit = tryRoutes(children, rest, parent.base, parent.params);
  if (!hit) return null;
  const render = (h) => React.createElement(RouteCtx.Provider, { value: { params: h.params, base: h.base, outlet: h.outlet ? render(h.outlet) : null } }, h.el ?? (h.outlet ? render(h.outlet) : null));
  return render(hit);
}
export const Route = () => null;
export const Outlet = () => useContext(RouteCtx).outlet;
export function Navigate({ to, replace }) { const nav = useNavigate(); useEffect(() => { nav(to, { replace }); }, [to]); return null; }
export const useNavigate = () => useContext(RouterCtx).navigate;
export const useInRouterContext = () => useContext(RouterCtx) != null;
export const useLocation = () => useContext(RouterCtx).location;
export const useParams = () => useContext(RouteCtx).params;
export function useSearchParams() {
  const { location: loc, navigate } = useContext(RouterCtx);
  const sp = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const set = useCallback((next, opts) => { const v = typeof next === 'function' ? next(new URLSearchParams(loc.search)) : new URLSearchParams(next); navigate(loc.pathname + (String(v) ? '?' + v : ''), opts); }, [loc.search, loc.pathname, navigate]);
  return [sp, set];
}
export const Link = React.forwardRef(function Link({ to, replace, onClick, children, ...rest }, ref) {
  const nav = useNavigate(); const href = typeof to === 'string' ? to : (to.pathname || '') + (to.search || '');
  return React.createElement('a', { ...rest, ref, href, onClick: (e) => { onClick && onClick(e); if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey) { e.preventDefault(); nav(href, { replace }); } } }, children);
});
export const NavLink = React.forwardRef(function NavLink({ to, className, style, children, end, ...rest }, ref) {
  const { location: loc } = useContext(RouterCtx); const href = typeof to === 'string' ? to : to.pathname;
  const isActive = end ? loc.pathname === href : loc.pathname === href || loc.pathname.startsWith(href.replace(/\/$/, '') + '/');
  const cn = typeof className === 'function' ? className({ isActive }) : className; const st = typeof style === 'function' ? style({ isActive }) : style;
  return React.createElement(Link, { ...rest, ref, to, className: cn, style: st, 'aria-current': isActive ? 'page' : undefined }, typeof children === 'function' ? children({ isActive }) : children);
});
