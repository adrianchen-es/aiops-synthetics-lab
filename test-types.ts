import { monitor } from '@elastic/synthetics';
type UseType = Parameters<typeof monitor.use>[0];
type Keys = keyof UseType;
