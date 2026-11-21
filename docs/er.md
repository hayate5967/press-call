# ER 図

テーブルは 12 個。認証まわり（6 個）、デバイスの設定と記録の指示（2 個）、記録まわり（4 個）。列の詳しい説明はデータ設計のドキュメントを参照。

```mermaid
erDiagram
  users ||--o{ oauth_accounts : "ログイン手段"
  users ||--o{ refresh_tokens : "発行"
  users ||--o{ devices : "所有"
  devices ||--o{ device_tokens : "発行"
  users ||--o{ training_sessions : "練習日"
  training_sessions ||--|{ sets : "含む"
  devices ||--o{ sets : "計測した"
  sets ||--o{ reps : "含む"
  sets ||--o| set_raw_data : "生データ"
  devices ||--|| device_settings : "設定"
  devices ||--o| device_recordings : "記録の指示"
  users |o--o{ device_authorizations : "許可する"
  device_authorizations }o--o| devices : "作られたデバイス"

  users {
    uuid id PK
    text email
    text display_name
    timestamptz created_at
  }
  oauth_accounts {
    uuid id PK
    uuid user_id FK
    text provider
    text provider_subject
    timestamptz created_at
  }
  refresh_tokens {
    uuid id PK
    uuid user_id FK
    uuid family_id
    text token_hash UK
    timestamptz expires_at
    timestamptz used_at
    timestamptz revoked_at
    timestamptz created_at
  }
  devices {
    uuid id PK
    uuid user_id FK
    text name
    timestamptz last_seen_at
    timestamptz created_at
  }
  device_tokens {
    uuid id PK
    uuid device_id FK
    text token_hash UK
    timestamptz last_used_at
    timestamptz revoked_at
    timestamptz created_at
  }
  device_authorizations {
    uuid id PK
    text device_code_hash UK
    text user_code UK
    text status
    timestamptz expires_at
    timestamptz last_polled_at
    uuid user_id FK
    uuid device_id FK
    text device_name
    timestamptz created_at
  }
  device_settings {
    uuid device_id PK
    text mode
    text pause_mode
    int pause_fixed_ms
    int pause_min_ms
    int pause_max_ms
    real still_threshold
    int version
    timestamptz updated_at
  }
  device_recordings {
    uuid device_id PK
    boolean recording
    int seq
    timestamptz started_at
    timestamptz stopped_at
    int acked_seq
    timestamptz updated_at
  }
  training_sessions {
    uuid id PK
    uuid user_id FK
    date session_date
    timestamptz created_at
  }
  sets {
    uuid id PK
    uuid session_id FK
    uuid device_id FK
    uuid client_set_id
    text mode
    text pause_mode
    int pause_fixed_ms
    int pause_min_ms
    int pause_max_ms
    timestamptz started_at
    timestamptz ended_at
    numeric weight_kg
    numeric rpe
    text note
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }
  reps {
    uuid id PK
    uuid set_id FK
    smallint rep_index
    int start_offset_ms
    int eccentric_ms
    int pause_target_ms
    int pause_actual_ms
    int reaction_ms
    boolean is_premature
    int concentric_ms
    real mean_velocity_mps
    real peak_velocity_mps
    smallint curve_hz
    real_array velocity_curve
  }
  set_raw_data {
    uuid set_id PK
    smallint sample_rate_hz
    smallint format_version
    int byte_size
    bytea payload
    timestamptz created_at
  }
```

`real_array` は PostgreSQL では `real[]`。主な制約：

- `oauth_accounts`：`(provider, provider_subject)` で UNIQUE
- `training_sessions`：`(user_id, session_date)` で UNIQUE（同じ日のセットは 1 つの練習日にまとまる）
- `sets`：`(device_id, client_set_id)` で UNIQUE（冪等キー。再送されても 1 行のまま）
- `reps`：`(set_id, rep_index)` で UNIQUE
