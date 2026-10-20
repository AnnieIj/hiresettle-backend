{{/*
Chart name, truncated to the 63-char DNS label limit.
*/}}
{{- define "hiresettle-backend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "hiresettle-backend.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "hiresettle-backend.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "hiresettle-backend.labels" -}}
helm.sh/chart: {{ include "hiresettle-backend.chart" . }}
{{ include "hiresettle-backend.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: hiresettle
{{- end }}

{{- define "hiresettle-backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hiresettle-backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "hiresettle-backend.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "hiresettle-backend.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Secret holding the app's sensitive env vars.
*/}}
{{- define "hiresettle-backend.secretName" -}}
{{- default (include "hiresettle-backend.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{/*
Secret holding the JWT signing keys file.
*/}}
{{- define "hiresettle-backend.jwtKeysSecretName" -}}
{{- default (printf "%s-jwt-keys" (include "hiresettle-backend.fullname" .)) .Values.jwtSigningKeys.existingSecret }}
{{- end }}

{{- define "hiresettle-backend.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
Shared env sources for the API and migration containers.
*/}}
{{- define "hiresettle-backend.envFrom" -}}
- configMapRef:
    name: {{ include "hiresettle-backend.fullname" . }}
- secretRef:
    name: {{ include "hiresettle-backend.secretName" . }}
{{- end }}
