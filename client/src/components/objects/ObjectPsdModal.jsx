import React from 'react';
import { X, Upload } from 'lucide-react';

export default function ObjectPsdModal({
  isOpen,
  onClose,
  onSave,
  psdEditingDoc,
  psdFormName,
  setPsdFormName,
  psdFormTypeId,
  setPsdFormTypeId,
  psdFormVersion,
  setPsdFormVersion,
  psdFormUrl,
  setPsdFormUrl,
  psdFormNotes,
  setPsdFormNotes,
  psdFormFileName,
  setPsdFormFile,
  setPsdFormFileName,
  psdErrorMessage,
  psdFormErrors = {},
  isSaving,
  t,
  getDocTypesList,
  getCleanFilename
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px'
    }}>
      <div className="animate-scale-in" style={{
        background: 'white', padding: '32px', borderRadius: '24px',
        width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '20px',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #cbd5e1'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>
            {psdEditingDoc ? (t.psdModalEditTitle || 'Редактировать документ ПСД') : (t.psdModalAddTitle || 'Добавить документ ПСД')}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {psdErrorMessage && (
            <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#ef4444', padding: '12px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '700' }}>
              ⚠️ {psdErrorMessage}
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
              {t.psdLabelName || 'Название документа'} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={psdFormName}
              onChange={(e) => setPsdFormName(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.name ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
              placeholder={t.psdPlaceholderName || "Введите название..."}
            />
          </div>

          <div style={{ display: 'flex', gap: '15px' }}>
            <div style={{ flex: 2 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                {t.psdLabelType || 'Тип документа'} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                value={psdFormTypeId}
                onChange={(e) => setPsdFormTypeId(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.type ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box', background: 'white' }}
              >
                <option value="">{t.psdPlaceholderSelectType || 'Выберите тип...'}</option>
                {getDocTypesList().map(dt => (
                  <option key={dt.id} value={dt.id}>{dt.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
                {t.psdLabelVersion || 'Версия'}
              </label>
              <input
                type="text"
                value={psdFormVersion}
                onChange={(e) => setPsdFormVersion(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
              {t.psdLabelSource || 'Источник документа'} <span style={{ color: '#ef4444' }}>*</span> {t.psdLabelSourceHint || '(загрузите файл ИЛИ укажите ссылку)'}
            </label>

            {/* File Upload Trigger */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
              <input
                type="file"
                id="psd-modal-upload-input"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const allowedExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf', 'jpg', 'jpeg', 'png', 'zip', 'rar'];
                    const ext = file.name.split('.').pop().toLowerCase();
                    
                    if (!allowedExts.includes(ext)) {
                      alert(t.errInvalidFileType || "Недопустимый формат файла. Выберите файл поддерживаемого формата");
                      e.target.value = '';
                      return;
                    }
                    if (file.size > 100 * 1024 * 1024) {
                      alert(t.errFileSizeExceeded || "Размер файла превышает допустимый лимит 100 МБ");
                      e.target.value = '';
                      return;
                    }

                    setPsdFormFile(file);
                    setPsdFormFileName(file.name);
                  }
                }}
              />
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => document.getElementById('psd-modal-upload-input').click()}
                  style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '8px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Upload size={14} /> {t.psdBtnChooseFile || 'Выбрать файл'}
                </button>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {psdFormFileName ? `📁 ${getCleanFilename(psdFormFileName)}` : (t.psdNoFileSelected || 'Файл не выбран')}
                </span>
                {psdFormFileName && (
                  <button
                    type="button"
                    onClick={() => { setPsdFormFile(null); setPsdFormFileName(''); }}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* URL Input */}
            <input
              type="text"
              value={psdFormUrl}
              onChange={(e) => setPsdFormUrl(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: psdFormErrors.url ? '2px solid #ef4444' : '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box' }}
              placeholder={t.psdPlaceholderUrl || "Или укажите ссылку на документ (https://...)"}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>
              {t.psdLabelNotes || 'Примечания'}
            </label>
            <textarea
              rows={2}
              value={psdFormNotes}
              onChange={(e) => setPsdFormNotes(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid #e2e8f0', outline: 'none', fontSize: '13px', fontWeight: '600', boxSizing: 'border-box', fontFamily: 'inherit' }}
              placeholder={t.psdPlaceholderNotes || "Дополнительные примечания..."}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', color: '#64748b' }}
              disabled={isSaving}
            >
              {t.btnCancel || 'Отмена'}
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ flex: 1, padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }}
              disabled={isSaving}
            >
              {isSaving ? (t.btnSaving || 'Сохранение...') : (t.btnSave || 'Сохранить')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
