export function validateDatabaseTargets(development?: string, test?: string) {
  if (!test || !development) {
    throw new Error("Se requieren TEST_DATABASE_URL y DATABASE_URL para validar aislamiento");
  }

  function parse(value: string) {
    try {
      const url = new URL(value);
      const database = decodeURIComponent(url.pathname.slice(1));
      // Rechazar overrides de host/base/opciones que el driver pudiera interpretar.
      if (!["postgres:", "postgresql:"].includes(url.protocol)
        || !url.hostname || !/^[a-zA-Z0-9_-]+$/.test(database)
        || url.hash || [...url.searchParams.keys()].some((key) => key !== "sslmode")
        || url.searchParams.getAll("sslmode").length > 1) {
        throw new Error();
      }
      const host = url.hostname.toLowerCase().replace(/\.$/, "");
      const direct = /^db\.([a-z]{20})\.supabase\.co$/.exec(host);
      const pooler = /^aws-(?:[0-9]+-)?[a-z]+-[a-z]+-[0-9]+\.pooler\.supabase\.com$/.test(host);
      const user = decodeURIComponent(url.username);
      const pooledUser = /^[a-zA-Z0-9_]+\.([a-z]{20})$/.exec(user);
      const project = direct?.[1] ?? (pooler ? pooledUser?.[1] : undefined);
      // Only documented Supabase endpoints prove project identity, never pooler IPs.
      // https://supabase.com/docs/guides/database/connecting-to-postgres
      if ((host.includes("supabase") || pooledUser) && (!project
        || !["", "5432", "6543"].includes(url.port)
        || (direct && !/^[a-zA-Z0-9_]+$/.test(user)))) {
        throw new Error();
      }
      return { url: value, database, project };
    } catch {
      throw new Error("URL PostgreSQL invalida o ambigua para aislamiento de pruebas");
    }
  }

  const dev = parse(development);
  const isolated = parse(test);
  if (Boolean(dev.project) !== Boolean(isolated.project)) {
    throw new Error("Identidad de proyecto Supabase no verificable para ambos destinos");
  }
  if (dev.project && dev.project === isolated.project) {
    throw new Error("Desarrollo y pruebas no pueden compartir proyecto Supabase");
  }
  if (dev.database.toLowerCase() === isolated.database.toLowerCase()
    && !(dev.project && isolated.project && dev.project !== isolated.project)) {
    throw new Error("La base de pruebas debe tener un nombre distinto de desarrollo");
  }
  return { development: dev, test: isolated };
}

export function validateDatabaseIdentities(
  targets: ReturnType<typeof validateDatabaseTargets>, development: string, test: string,
) {
  if (development !== targets.development.database || test !== targets.test.database
    || (development.toLowerCase() === test.toLowerCase()
      && !(targets.development.project && targets.test.project
        && targets.development.project !== targets.test.project))) {
    throw new Error("Identidad PostgreSQL no coincide con el destino separado esperado");
  }
}
