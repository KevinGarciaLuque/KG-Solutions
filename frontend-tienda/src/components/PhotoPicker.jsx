import { useEffect, useMemo } from "react";
import { MAX_FOTOS, MAX_MB, validarFotosCliente } from "../utils/servicios.js";

// Selector de fotos con vista previa. `value` = array de File.
const PhotoPicker = ({ value, onChange, onError, label = "Fotos (opcional)" }) => {
  const previews = useMemo(() => value.map((f) => URL.createObjectURL(f)), [value]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const agregar = (e) => {
    const r = validarFotosCliente(value, Array.from(e.target.files || []));
    e.target.value = "";
    if (r.error) return onError?.(r.error);
    onError?.("");
    onChange(r.lista);
  };

  return (
    <div>
      <label className="form-label fw-semibold">{label}</label>
      <input
        type="file"
        className="form-control"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={agregar}
        disabled={value.length >= MAX_FOTOS}
      />
      <div className="form-text">
        Hasta {MAX_FOTOS} imágenes JPG, PNG o WebP de máximo {MAX_MB} MB. Puedes enviar la solicitud sin fotos.
      </div>
      {value.length > 0 && (
        <div className="d-flex flex-wrap gap-2 mt-2">
          {previews.map((src, i) => (
            <div key={src} className="position-relative">
              <img src={src} alt={`Foto ${i + 1}`} style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8 }} />
              <button
                type="button"
                className="btn btn-sm btn-danger position-absolute top-0 end-0 p-0"
                style={{ width: 22, height: 22, lineHeight: 1 }}
                aria-label="Quitar foto"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PhotoPicker;
