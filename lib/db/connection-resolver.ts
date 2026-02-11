export type EnvCandidate = { name: string; value: string | undefined };

export function nonEmptyEnvValues(candidates: ReadonlyArray<EnvCandidate>): Array<{ source: string; value: string }> {
  const resolved: Array<{ source: string; value: string }> = [];

  for (const candidate of candidates) {
    if (typeof candidate.value !== "string") {
      continue;
    }
    const trimmed = candidate.value.trim();
    if (trimmed.length > 0) {
      resolved.push({ source: candidate.name, value: trimmed });
    }
  }

  return resolved;
}

export function getDatabaseHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
}

export function getDatabaseHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid-url";
  }
}

function hasDatabasePassword(value: string): boolean {
  try {
    return new URL(value).password.length > 0;
  } catch {
    return false;
  }
}

function getDatabaseIdentity(value: string): { username: string; password: string; database: string } | null {
  try {
    const parsed = new URL(value);
    return {
      username: parsed.username,
      password: parsed.password,
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

export function isNeonHostname(hostname: string): boolean {
  return hostname.endsWith(".aws.neon.tech");
}

function isPoolerHostname(hostname: string): boolean {
  return hostname.includes("-pooler.");
}

export function buildAppUrlWithFallbackCredentials(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const appUrl = value.trim();
  if (!appUrl) {
    return undefined;
  }

  const fallbackUser = process.env.PGUSER?.trim() || process.env.POSTGRES_USER?.trim();
  const fallbackPassword = process.env.PGPASSWORD?.trim() || process.env.POSTGRES_PASSWORD?.trim();

  if (!fallbackUser && !fallbackPassword) {
    return undefined;
  }

  try {
    const parsed = new URL(appUrl);
    let changed = false;

    if (!parsed.username && fallbackUser) {
      parsed.username = fallbackUser;
      changed = true;
    }

    if (!parsed.password && fallbackPassword) {
      parsed.password = fallbackPassword;
      changed = true;
    }

    return changed ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function selectDatabaseUrl(candidates: ReadonlyArray<EnvCandidate>): { source: string; value: string } | null {
  const allNonEmpty = nonEmptyEnvValues(candidates);
  const candidatesWithPassword = allNonEmpty.filter((candidate) => hasDatabasePassword(candidate.value));
  const passwordlessSources =
    candidatesWithPassword.length > 0
      ? allNonEmpty
          .filter((candidate) => !hasDatabasePassword(candidate.value))
          .map((candidate) => candidate.source)
      : [];

  if (passwordlessSources.length > 0) {
    console.warn("[db] ignoring passwordless datasource candidates", {
      ignoredSources: passwordlessSources,
    });
  }

  const prioritizedCandidates = candidatesWithPassword.length > 0 ? candidatesWithPassword : allNonEmpty;
  const first = prioritizedCandidates[0] ?? null;
  if (!first) {
    return null;
  }

  const firstHostname = getDatabaseHostname(first.value);
  if (!isNeonHostname(firstHostname) || isPoolerHostname(firstHostname)) {
    return first;
  }

  if (first.source.startsWith("APP_DATABASE_URL")) {
    return first;
  }

  const firstIdentity = getDatabaseIdentity(first.value);
  const poolerCandidate = prioritizedCandidates.find((candidate) => {
    const hostname = getDatabaseHostname(candidate.value);
    if (!isNeonHostname(hostname) || !isPoolerHostname(hostname)) {
      return false;
    }

    if (!firstIdentity) {
      return true;
    }

    const candidateIdentity = getDatabaseIdentity(candidate.value);
    return (
      candidateIdentity?.username === firstIdentity.username &&
      candidateIdentity?.password === firstIdentity.password &&
      candidateIdentity?.database === firstIdentity.database
    );
  });

  if (poolerCandidate) {
    return {
      source: `${poolerCandidate.source} (auto-selected Neon pooler host over ${first.source})`,
      value: poolerCandidate.value,
    };
  }

  return first;
}

export function normalizeDatabaseUrl(value: string): { value: string; adjustments: string[] } {
  const adjustments: string[] = [];

  try {
    const parsed = new URL(value);
    const isNeonHost = isNeonHostname(parsed.hostname);

    if (isNeonHost) {
      if (!parsed.searchParams.get("sslmode")) {
        parsed.searchParams.set("sslmode", "require");
        adjustments.push("sslmode=require");
      }

      if (!parsed.searchParams.get("connect_timeout")) {
        parsed.searchParams.set("connect_timeout", "15");
        adjustments.push("connect_timeout=15");
      }
    }

    return {
      value: parsed.toString(),
      adjustments,
    };
  } catch {
    return { value, adjustments };
  }
}
