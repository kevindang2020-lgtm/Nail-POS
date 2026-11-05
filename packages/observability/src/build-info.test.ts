// build-info.vitest.spec — Constitution 11 §68–69: the release marker is real or 'unknown', never guessed.
import { describe, it, expect, afterEach } from 'vitest';
import { buildInfoFrom, BUILD } from './build-info';
import { log, setLogSink, type LogRecord } from './logger';
import { registry } from './metrics';

afterEach(() => setLogSink(null));
describe('build info', () => {
  it('reads the pipeline\'s version and commit', () => expect(buildInfoFrom({ APP_VERSION: '4.2.8', GIT_SHA: 'abc1234' })).toMatchObject({ version: '4.2.8', commit: 'abc1234' }));
  it('unknown when nothing is set — not a made-up version', () => expect(buildInfoFrom({}).version).toBe('unknown'));
  it('sanitises and caps — a hostile env value cannot become a label or a log field', () => {
    const b = buildInfoFrom({ APP_VERSION: '<script>' + 'x'.repeat(100) });
    expect(b.version.length).toBeLessThanOrEqual(40); expect(b.version).not.toMatch(/[<>]/);
  });
  it('§6 every log line carries the deployment version', () => {
    const lines: LogRecord[] = []; setLogSink({ write: (r) => lines.push(r) });
    log.info('x'); expect((lines[0] as any).deploymentVersion).toBe(BUILD.version);
  });
  it('§69 the registry exposes a release marker gauge labelled by version and commit', () => {
    const rows = registry.snapshot()['aipowersalon_build_info'];
    expect(rows[0]).toMatchObject({ value: 1, labels: { version: BUILD.version, commit: BUILD.commit } });
  });
});

describe('on Railway it turns on by itself', () => {
  const RAILWAY = { RAILWAY_GIT_COMMIT_SHA: '62eb613a1b2c3d4e5f60718293a4b5c6d7e8f901', RAILWAY_DEPLOYMENT_ID: 'dep-7f3a', RAILWAY_ENVIRONMENT_NAME: 'production' };
  it('commit, deployment and environment come from Railway\'s own variables', () => {
    expect(buildInfoFrom(RAILWAY, new Date(), '1.0.0')).toMatchObject({ commit: RAILWAY.RAILWAY_GIT_COMMIT_SHA, deployment: 'dep-7f3a', environment: 'production' });
  });
  it('the version is package.json + short commit, so two releases never share a label ("1.0.0" alone would)', () => {
    expect(buildInfoFrom(RAILWAY, new Date(), '1.0.0').version).toBe('1.0.0+62eb613');
  });
  it('an explicit APP_VERSION / GIT_SHA from a pipeline still wins', () => {
    expect(buildInfoFrom({ ...RAILWAY, APP_VERSION: '4.2.8', GIT_SHA: 'abc1234' }, new Date(), '1.0.0')).toMatchObject({ version: '4.2.8', commit: 'abc1234' });
  });
  it('outside Railway with nothing set: package version alone, commit unknown — never a guess', () => {
    expect(buildInfoFrom({}, new Date(), '1.0.0')).toMatchObject({ version: '1.0.0', commit: 'unknown', deployment: 'unknown' });
  });
});
