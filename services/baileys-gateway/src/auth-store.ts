import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { Pool, type PoolClient } from "pg";

type EncryptedValue = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

type StoredAuthRow = {
  key_id: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
};

export function encryptAuthValue(
  value: unknown,
  encryptionKey: Buffer
): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const serialized = JSON.stringify(value, BufferJSON.replacer);
  const ciphertext = Buffer.concat([
    cipher.update(serialized, "utf8"),
    cipher.final(),
  ]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptAuthValue(value: EncryptedValue, encryptionKey: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, value.iv);
  decipher.setAuthTag(value.authTag);
  const serialized = Buffer.concat([
    decipher.update(value.ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(serialized, BufferJSON.reviver) as unknown;
}

export class PostgresAuthStore {
  constructor(
    private readonly pool: Pool,
    private readonly sessionId: string,
    private readonly encryptionKey: Buffer
  ) {}

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS baileys_auth_state (
        session_id varchar(120) NOT NULL,
        key_id text NOT NULL,
        ciphertext bytea NOT NULL,
        iv bytea NOT NULL,
        auth_tag bytea NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, key_id)
      )
    `);
  }

  private async readValue(keyId: string) {
    const result = await this.pool.query<StoredAuthRow>(
      `SELECT key_id, ciphertext, iv, auth_tag
         FROM baileys_auth_state
        WHERE session_id = $1 AND key_id = $2`,
      [this.sessionId, keyId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return decryptAuthValue(
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      },
      this.encryptionKey
    );
  }

  private async writeValue(
    client: Pool | PoolClient,
    keyId: string,
    value: unknown
  ) {
    const encrypted = encryptAuthValue(value, this.encryptionKey);
    await client.query(
      `INSERT INTO baileys_auth_state
        (session_id, key_id, ciphertext, iv, auth_tag, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (session_id, key_id) DO UPDATE SET
         ciphertext = EXCLUDED.ciphertext,
         iv = EXCLUDED.iv,
         auth_tag = EXCLUDED.auth_tag,
         updated_at = now()`,
      [
        this.sessionId,
        keyId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
      ]
    );
  }

  async load(): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
  }> {
    const creds =
      ((await this.readValue("creds")) as
        | AuthenticationState["creds"]
        | null) ?? initAuthCreds();

    const keys: AuthenticationState["keys"] = {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[]
      ) => {
        if (ids.length === 0) return {};
        const keyIds = ids.map(id => `${type}:${id}`);
        const result = await this.pool.query<StoredAuthRow>(
          `SELECT key_id, ciphertext, iv, auth_tag
             FROM baileys_auth_state
            WHERE session_id = $1 AND key_id = ANY($2::text[])`,
          [this.sessionId, keyIds]
        );
        const rows = new Map(result.rows.map(row => [row.key_id, row]));
        const values: Record<string, SignalDataTypeMap[T]> = {};

        for (const id of ids) {
          const row = rows.get(`${type}:${id}`);
          if (!row) continue;
          let value = decryptAuthValue(
            {
              ciphertext: row.ciphertext,
              iv: row.iv,
              authTag: row.auth_tag,
            },
            this.encryptionKey
          ) as SignalDataTypeMap[T];
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(
              value as proto.Message.IAppStateSyncKeyData
            ) as unknown as SignalDataTypeMap[T];
          }
          values[id] = value;
        }
        return values;
      },
      set: async (data: SignalDataSet) => {
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          for (const category of Object.keys(data) as Array<
            keyof SignalDataTypeMap
          >) {
            const entries = data[category];
            if (!entries) continue;
            for (const [id, value] of Object.entries(entries)) {
              const keyId = `${category}:${id}`;
              if (value == null) {
                await client.query(
                  `DELETE FROM baileys_auth_state
                    WHERE session_id = $1 AND key_id = $2`,
                  [this.sessionId, keyId]
                );
              } else {
                await this.writeValue(client, keyId, value);
              }
            }
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };

    return {
      state: { creds, keys },
      saveCreds: () => this.writeValue(this.pool, "creds", creds),
    };
  }

  async clearSession() {
    await this.pool.query(
      "DELETE FROM baileys_auth_state WHERE session_id = $1",
      [this.sessionId]
    );
  }
}
