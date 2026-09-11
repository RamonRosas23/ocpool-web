import React, { useState } from 'react';
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarHeading,
  ComboBox,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  DialogTrigger,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  Popover,
  Select,
  SelectValue,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from 'react-aria-components';
import { CalendarDays, CheckCircle2, ChevronDown, MessageCircle, Search } from 'lucide-react';
import { parseDate } from '@internationalized/date';

const mxnFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  currencyDisplay: 'code',
});

const concepts = [
  { id: 'acabado-mate', name: 'Acabado mate', unit: 'm²' },
  { id: 'aluminio-natural', name: 'Aluminio natural', unit: 'm²' },
  { id: 'vidrio-templado', name: 'Vidrio templado', unit: 'm²' },
  { id: 'herrajes-premium', name: 'Herrajes premium', unit: 'juego' },
];

function SelectSpike() {
  return (
    <section className="spike-card" aria-labelledby="select-title">
      <div className="spike-card__eyebrow">Catálogo</div>
      <h2 id="select-title">Select y ComboBox</h2>
      <p className="spike-card__copy">Buscar un concepto sin recorrer listas largas y elegir una lista de precios sin perder el contexto.</p>
      <div className="spike-fields">
        <ComboBox aria-label="Concepto del catálogo" defaultItems={concepts} allowsEmptyCollection>
          <Label>Concepto</Label>
          <div className="spike-control">
            <Search size={16} aria-hidden="true" />
            <Input placeholder="Busca por nombre o clave" />
            <Button aria-label="Abrir conceptos"><ChevronDown size={16} aria-hidden="true" /></Button>
          </div>
          <Popover className="spike-popover">
            <ListBox className="spike-listbox">
              {(item) => <ListBoxItem id={item.id} textValue={`${item.name} ${item.unit}`} className="spike-listbox__item">
                <span>{item.name}</span><small>{item.unit}</small>
              </ListBoxItem>}
            </ListBox>
          </Popover>
        </ComboBox>
        <Select aria-label="Lista de precios" defaultSelectedKey="lista-base">
          <Label>Lista de precios</Label>
          <Button className="spike-control"><SelectValue /><ChevronDown size={16} aria-hidden="true" /></Button>
          <Popover className="spike-popover"><ListBox className="spike-listbox">
            <ListBoxItem id="lista-base" className="spike-listbox__item">Base MXN</ListBoxItem>
            <ListBoxItem id="lista-premium" className="spike-listbox__item">Premium MXN</ListBoxItem>
          </ListBox></Popover>
        </Select>
      </div>
    </section>
  );
}

function DateSpike() {
  return (
    <section className="spike-card" aria-labelledby="date-title">
      <div className="spike-card__eyebrow">Vigencia</div>
      <h2 id="date-title">Fecha localizada</h2>
      <p className="spike-card__copy">Entrada segmentada, calendario y locale es-MX con navegación completa por teclado.</p>
      <DatePicker aria-label="Vigencia de la propuesta" defaultValue={parseDate('2026-09-30')} locale="es-MX">
        <Label>Válida hasta</Label>
        <div className="spike-control">
          <DateInput>{(segment) => <DateSegment segment={segment} />}</DateInput>
          <Button aria-label="Abrir calendario"><CalendarDays size={16} aria-hidden="true" /></Button>
        </div>
        <Popover className="spike-popover spike-popover--calendar">
          <Dialog aria-label="Calendario de vigencia">
            <Calendar>
              <header className="calendar-header"><Button slot="previous">‹</Button><CalendarHeading /><Button slot="next">›</Button></header>
              <CalendarGrid>{(date) => <CalendarCell date={date} />}</CalendarGrid>
            </Calendar>
          </Dialog>
        </Popover>
      </DatePicker>
    </section>
  );
}

function DialogSpike() {
  return (
    <section className="spike-card" aria-labelledby="dialog-title">
      <div className="spike-card__eyebrow">Aceptación</div>
      <h2 id="dialog-title">Diálogo con foco seguro</h2>
      <p className="spike-card__copy">Escape, foco inicial, restore y bloqueo de interacción fuera del diálogo.</p>
      <DialogTrigger>
        <Button className="spike-primary"><CheckCircle2 size={16} aria-hidden="true" /> Revisar y aceptar</Button>
        <Modal className="spike-modal">
          <Dialog className="spike-dialog">
            {({ close }) => <>
              <div className="spike-card__eyebrow">Versión 3 · MXN</div>
              <Heading slot="title">Aceptar propuesta</Heading>
              <p>La versión publicada queda registrada y no se puede modificar.</p>
              <p className="spike-total"><span id="spike-total-label">Total estimado</span><output aria-labelledby="spike-total-label" data-locale="es-MX" data-currency="MXN">{mxnFormatter.format(3480)}</output></p>
              <label className="spike-label">Nombre de quien acepta<input autoFocus placeholder="Nombre completo" /></label>
              <div className="spike-dialog__actions"><Button onPress={close}>Cancelar</Button><Button className="spike-primary" onPress={close}>Aceptar propuesta</Button></div>
            </>}
          </Dialog>
        </Modal>
      </DialogTrigger>
    </section>
  );
}

function TabsSpike() {
  const [selectedKey, setSelectedKey] = useState('messages');
  return (
    <section className="spike-card" aria-labelledby="tabs-title">
      <div className="spike-card__eyebrow">Expediente</div>
      <h2 id="tabs-title">Tabs operativas</h2>
      <p className="spike-card__copy">Flechas, Home/End, anuncio de estado y panel asociado para mensajes y archivos.</p>
      <Tabs selectedKey={selectedKey} onSelectionChange={(key) => setSelectedKey(String(key))}>
        <TabList aria-label="Contenido del expediente" className="spike-tabs">
          <Tab id="messages"><MessageCircle size={16} aria-hidden="true" /> Mensajes</Tab>
          <Tab id="files">Archivos</Tab>
        </TabList>
        <TabPanel id="messages" className="spike-panel">Conversación visible para el cliente y notas internas separadas.</TabPanel>
        <TabPanel id="files" className="spike-panel">Documentos compartidos con estado de validación y descarga segura.</TabPanel>
      </Tabs>
    </section>
  );
}

function App() {
  return <main className="spike-shell">
    <header className="spike-hero"><p className="spike-card__eyebrow">OCPOOL · SPIKE G0-04</p><h1>Primitives privadas comparables</h1><p>Prototipo aislado: no es una ruta de producción ni toca la landing.</p></header>
    <div className="spike-grid"><SelectSpike /><DateSpike /><DialogSpike /><TabsSpike /></div>
  </main>;
}

export default App;
